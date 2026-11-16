import { JSDOM } from 'jsdom';
import { blocks, ignored, visibleText } from '../shared/html';
import { translateBatch } from './transport';
import type { Request, TranslationOptions } from './transport';

interface Template {
	node: Node;
	opaque: boolean;
}
interface Chunk {
	source: string;
	templates: Map<string, Template>;
	leading: string;
	trailing: string;
	translatable: boolean;
}
interface Unit {
	parent: Element;
	nodes: Node[];
	chunks: Chunk[];
}

function encode(fragment: DocumentFragment): Chunk {
	const templates = new Map<string, Template>();
	function visit(node: Node): string {
		if (node.nodeType === 3)
			return (node.textContent || '')
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
		const tag = `b${10 + templates.size}`;
		const opaque = node.nodeType !== 1 || ignored(node as Element) || !node.textContent?.trim();
		templates.set(tag, { node, opaque });
		return `<${tag}>${opaque ? '' : Array.from(node.childNodes, visit).join('')}</${tag}>`;
	}
	return {
		source: Array.from(fragment.childNodes, visit).join(''),
		templates,
		translatable: /\p{L}/u.test(Array.from(fragment.childNodes, visibleText).join('')),
		leading: /^\s*/u.exec(fragment.textContent || '')![0],
		trailing: /\s*$/u.exec(fragment.textContent || '')![0],
	};
}

function split(fragment: DocumentFragment, doc: Document): Chunk[] {
	const walker = doc.createTreeWalker(fragment, 4);
	const entries: { node: Node; start: number }[] = [];
	let node: Node | null,
		text = '';
	while ((node = walker.nextNode())) {
		entries.push({ node, start: text.length });
		text += node.textContent;
	}
	if (text.length <= 1800) return [encode(fragment)];
	const cuts = [0];
	while (text.length - cuts[cuts.length - 1] > 1800) {
		const start = cuts[cuts.length - 1];
		const window = text.slice(start, start + 1800);
		const sentences = [...window.matchAll(/[.!?。！？](?:\s|$)|\n/g)];
		let end = sentences.at(-1)?.index ?? -1;
		if (end < 900) end = window.lastIndexOf(' ');
		if (end < 900) end = 1799;
		end += start + 1;
		if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
		cuts.push(end);
	}
	cuts.push(text.length);
	function point(offset: number): [Node, number] {
		const entry = [...entries].reverse().find((entry) => entry.start <= offset)!;
		return [entry.node, offset - entry.start];
	}
	return cuts.slice(0, -1).map((start, index) => {
		const range = doc.createRange();
		if (!start) range.setStart(fragment, 0);
		else range.setStart(...point(start));
		if (cuts[index + 1] === text.length) range.setEnd(fragment, fragment.childNodes.length);
		else range.setEnd(...point(cuts[index + 1]));
		return encode(range.cloneContents());
	});
}

function collect(doc: Document): Unit[] {
	const units: Unit[] = [];
	function walk(parent: Element) {
		if (ignored(parent)) return;
		let inline: Node[] = [];
		function flush() {
			if (/\p{L}/u.test(inline.map(visibleText).join(''))) {
				const fragment = doc.createDocumentFragment();
				inline.forEach((node) => fragment.append(node.cloneNode(true)));
				units.push({ parent, nodes: inline, chunks: split(fragment, doc) });
			}
			inline = [];
		}
		for (const node of parent.childNodes) {
			if (node.nodeType === 1) {
				const element = node as Element;
				if (ignored(element)) {
					if (
						blocks.has(element.localName) ||
						['pre', 'script', 'style'].includes(element.localName)
					)
						flush();
					else inline.push(node);
					continue;
				}
				if (
					blocks.has(element.localName) ||
					Array.from(element.querySelectorAll('*')).some((child) => blocks.has(child.localName))
				) {
					flush();
					walk(element);
					continue;
				}
			}
			inline.push(node);
		}
		flush();
	}
	walk(doc.body);
	return units;
}

function decode(chunk: Chunk, text: string, doc: Document): DocumentFragment {
	const template = doc.createElement('template');
	template.innerHTML = text;
	const fragment = doc.createDocumentFragment();
	const seen = new Set<string>();
	function visit(node: Node): Node {
		if (node.nodeType === 3) return doc.createTextNode(node.textContent || '');
		const tag = (node as Element).localName;
		const original = chunk.templates.get(tag);
		if (!original || seen.has(tag))
			throw new Error('Translation changed HTML placeholders; try another provider');
		seen.add(tag);
		if (original.opaque && node.childNodes.length)
			throw new Error('Translation changed a protected HTML placeholder');
		const restored = doc.importNode(original.node, original.opaque);
		if (!original.opaque) for (const child of node.childNodes) restored.appendChild(visit(child));
		return restored;
	}
	for (const node of template.content.childNodes) fragment.append(visit(node));
	if (seen.size !== chunk.templates.size || (chunk.translatable && !fragment.textContent?.trim()))
		throw new Error('Translation lost HTML content or placeholders');
	const leading = /^\s*/u.exec(fragment.textContent || '')![0];
	const trailing = /\s*$/u.exec(fragment.textContent || '')![0];
	if (chunk.leading.length > leading.length)
		fragment.prepend(doc.createTextNode(chunk.leading.slice(leading.length)));
	if (chunk.trailing.length > trailing.length)
		fragment.append(doc.createTextNode(chunk.trailing.slice(trailing.length)));
	return fragment;
}

export async function translateHtml(
	html: string,
	request: Request,
	options: TranslationOptions,
): Promise<string> {
	const fullDocument = /<!doctype\b|<html[\s>]|<head[\s>]|<body[\s>]/i.test(html);
	const dom = new JSDOM(html);
	try {
		const doc = dom.window.document;
		const units = collect(doc);
		const chunks = units.flatMap((unit) => unit.chunks);
		let lastRequest = 0;
		const pacedRequest: Request = async (config) => {
			const wait = 400 - (Date.now() - lastRequest);
			if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
			lastRequest = Date.now();
			return request(config);
		};
		async function translateSources(sources: string[]): Promise<Map<string, string>> {
			const unique = [...new Set(sources)];
			const results = new Map<string, string>();
			for (let index = 0; index < unique.length; ) {
				const batch: string[] = [];
				let length = 0;
				while (
					index < unique.length &&
					batch.length < 20 &&
					(!batch.length || length + unique[index].length <= 6000)
				) {
					const source = unique[index++];
					batch.push(source);
					length += source.length;
				}
				const translated = await translateBatch(pacedRequest, batch, options);
				batch.forEach((source, i) => results.set(source, translated[i]));
			}
			return results;
		}
		const translations = await translateSources(
			chunks.filter((chunk) => chunk.translatable).map((chunk) => chunk.source),
		);
		async function restore(chunk: Chunk): Promise<DocumentFragment> {
			if (!chunk.translatable) return decode(chunk, chunk.source, doc);
			try {
				return decode(chunk, translations.get(chunk.source)!, doc);
			} catch {
				// Some services remove empty tags or alter nesting; translate text in the original layout.
				const template = doc.createElement('template');
				template.innerHTML = chunk.source;
				const walker = doc.createTreeWalker(template.content, 4);
				const nodes: Node[] = [];
				let node: Node | null;
				while ((node = walker.nextNode()))
					if (/\p{L}/u.test(node.textContent || '')) nodes.push(node);
				const repaired = await translateSources(nodes.map((node) => node.textContent!));
				for (const node of nodes) {
					const original = node.textContent!;
					node.textContent =
						/^\s*/u.exec(original)![0] +
						repaired.get(original)!.trim() +
						/\s*$/u.exec(original)![0];
				}
				return decode(chunk, template.innerHTML, doc);
			}
		}
		for (const unit of units) {
			const translated = doc.createDocumentFragment();
			for (const chunk of unit.chunks) translated.append(await restore(chunk));
			const ids = new Set<string>();
			for (const element of translated.querySelectorAll('[id]')) {
				const id = element.getAttribute('id')!;
				if (ids.has(id)) element.removeAttribute('id');
				else ids.add(id);
			}
			if (options.bilingual) {
				const wrapper = doc.createElement('span');
				wrapper.className = 'html-tools-translation';
				wrapper.lang = options.target;
				wrapper.style.display = 'block';
				wrapper.append(translated);
				for (const element of wrapper.querySelectorAll('[id], [name]')) {
					element.removeAttribute('id');
					element.removeAttribute('name');
				}
				unit.parent.insertBefore(wrapper, unit.nodes[unit.nodes.length - 1].nextSibling);
			} else {
				unit.parent.insertBefore(translated, unit.nodes[0]);
				unit.nodes.forEach((node) => unit.parent.removeChild(node));
			}
		}
		if (!options.bilingual && fullDocument && units.length)
			doc.documentElement.lang = options.target;
		return fullDocument ? dom.serialize() : doc.body.innerHTML;
	} finally {
		dom.window.close();
	}
}
