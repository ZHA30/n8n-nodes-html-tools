import { JSDOM } from 'jsdom';

export const skip =
	'script,style,code,pre,svg,math,rt,rp,[hidden],[translate="no"],.html-tools-translation';
export const blocks = new Set(
	'address article aside blockquote body caption dd details div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p section table tbody td tfoot th thead tr ul'.split(
		' ',
	),
);

export function ignored(element: Element): boolean {
	return (
		element.matches(skip) ||
		/display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute('style') || '')
	);
}

export function visibleText(node: Node): string {
	if (node.nodeType === 3) return node.textContent || '';
	if (node.nodeType !== 1 || ignored(node as Element)) return '';
	return Array.from(node.childNodes, visibleText).join(
		blocks.has((node as Element).localName) ? '\n' : '',
	);
}

export function htmlText(html: string): string {
	const dom = new JSDOM(html);
	try {
		return visibleText(dom.window.document.body);
	} finally {
		dom.window.close();
	}
}
