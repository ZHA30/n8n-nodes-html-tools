const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { detectLanguage } = require('../dist/nodes/LanguageDetect/language');
const { translateHtml } = require('../dist/nodes/HtmlTranslate/html');
const { translateBatch } = require('../dist/nodes/HtmlTranslate/transport');
const options = { provider: 'google', source: 'en', target: 'zh-CN', bilingual: false };
const texts = (config) =>
	typeof config.body === 'string' ? new URLSearchParams(config.body).getAll('q') : config.body;
const translate = async (config) =>
	texts(config).map((text) => text.replaceAll('Hello', '你好').replaceAll('world', '世界'));

test('language comes from visible content and empty input is undetermined', () => {
	assert.equal(
		detectLanguage(
			'<html lang="fr"><head><title>Bonjour</title></head><body><script>bonjour</script><p>This is an English article about the history of modern science and the development of new technology.</p></body></html>',
		),
		'en',
	);
	assert.equal(detectLanguage('<style>body {color:red}</style><p>123</p>'), 'und');
	assert.equal(
		detectLanguage('这是一篇中文文章，介绍科学技术的发展以及它对日常生活的影响。', false),
		'zh',
	);
});

test('translation preserves inline links, protected content, attributes and fragment shape', async () => {
	const result = await translateHtml(
		'<p id="p">Hello <a href="/world" title="Keep">world</a><code>code</code><img src="a.png"></p><pre>Hello world</pre><p translate="no">Hello world</p>',
		translate,
		options,
	);
	const dom = new JSDOM(result),
		doc = dom.window.document;
	assert.equal(doc.querySelector('p').id, 'p');
	assert.equal(doc.querySelector('a').textContent, '世界');
	assert.equal(doc.querySelector('a').getAttribute('href'), '/world');
	assert.equal(doc.querySelector('a').title, 'Keep');
	assert.equal(doc.querySelector('code').textContent, 'code');
	assert.equal(doc.querySelector('pre').textContent, 'Hello world');
	assert.equal(doc.querySelector('[translate="no"]').textContent, 'Hello world');
	assert.equal(doc.querySelector('img').getAttribute('src'), 'a.png');
	assert.ok(!result.includes('<html'));
	dom.window.close();
});

test('bilingual content stays inside list items and table cells without duplicate IDs', async () => {
	const result = await translateHtml(
		'<p>Hello world</p><ul><li>Hello <a id="link" href="#link">world</a></li></ul><table><tr><td>Hello world</td></tr></table>',
		translate,
		{ ...options, bilingual: true },
	);
	const dom = new JSDOM(result),
		doc = dom.window.document;
	assert.equal(doc.querySelectorAll('li').length, 1);
	assert.equal(doc.querySelectorAll('td').length, 1);
	assert.equal(doc.querySelectorAll('#link').length, 1);
	for (const translation of doc.querySelectorAll('.html-tools-translation')) {
		assert.equal(translation.previousSibling.localName, 'br');
		assert.equal(translation.hasAttribute('style'), false);
	}
	assert.equal(doc.querySelectorAll('br').length, 3);
	assert.equal(doc.querySelector('li > .html-tools-translation').textContent, '你好 世界');
	assert.equal(doc.querySelector('td > .html-tools-translation').lang, 'zh-CN');
	assert.ok(doc.querySelector('li').textContent.startsWith('Hello world'));
	dom.window.close();
});

test('long paragraphs split and repeated chunks translate once', async () => {
	let calls = 0,
		count = 0;
	const request = async (config) => {
		calls++;
		count += texts(config).length;
		return translate(config);
	};
	const repeated = 'Hello world. '.repeat(400);
	const result = await translateHtml(`<p>${repeated}</p><p>${repeated}</p>`, request, options);
	const dom = new JSDOM(result);
	assert.equal(dom.window.document.querySelectorAll('p').length, 2);
	assert.equal(
		dom.window.document.querySelector('p').textContent,
		repeated.replaceAll('Hello', '你好').replaceAll('world', '世界'),
	);
	assert.ok(count >= 2 && count <= 4);
	assert.ok(calls <= 2);
	dom.window.close();
});

test('damaged placeholders are repaired from original text nodes without injecting markup', async () => {
	const repaired = await translateHtml(
		'<p>Hello <a href="/">world</a><img src="cover.png"></p>',
		async (config) => {
			const sources = texts(config);
			if (sources[0].includes('<b')) return ['你好世界'];
			return sources.map((text) => text.replace('Hello', '你好').replace('world', '世界'));
		},
		options,
	);
	const dom = new JSDOM(repaired);
	assert.equal(dom.window.document.querySelector('a').getAttribute('href'), '/');
	assert.equal(dom.window.document.querySelector('a').textContent, '世界');
	assert.equal(dom.window.document.querySelector('img').getAttribute('src'), 'cover.png');
	dom.window.close();
	const injected = await translateHtml(
		'<p>Hello world</p>',
		async () => ['<img src=x onerror=alert(1)>'],
		options,
	);
	assert.ok(!injected.includes('<img'));
	await assert.rejects(
		translateHtml('<p>Hello world</p>', async () => [], options),
		/count/,
	);
});

test('an empty Google batch entry is retried separately', async () => {
	const calls = [];
	const translated = await translateBatch(
		async (config) => {
			calls.push(texts(config));
			return calls.length === 1
				? [
						['你好', 'en'],
						[null, 'en'],
					]
				: [['世界', 'en']];
		},
		['Hello', 'world'],
		options,
	);
	assert.deepEqual(translated, ['你好', '世界']);
	assert.deepEqual(calls, [['Hello', 'world'], ['world']]);
	await assert.rejects(
		translateBatch(async () => [[null, 'en']], ['Hello'], options),
		/empty or invalid/,
	);
});

test('Microsoft request maps language codes and omits auto source', async () => {
	const result = await translateBatch(
		async (config) => {
			assert.equal(config.qs.to, 'zh-Hant');
			assert.ok(!('from' in config.qs));
			assert.deepEqual(config.body, ['Hello']);
			return [{ translations: [{ text: '你好' }] }];
		},
		['Hello'],
		{ ...options, provider: 'microsoft', source: 'auto', target: 'zh-TW' },
	);
	assert.deepEqual(result, ['你好']);
});

test('full documents retain their head and set translated document language', async () => {
	const result = await translateHtml(
		'<!doctype html><html lang="en"><head><title>Original title</title></head><body><p>Hello world</p></body></html>',
		translate,
		options,
	);
	const dom = new JSDOM(result);
	assert.equal(dom.window.document.documentElement.lang, 'zh-CN');
	assert.equal(dom.window.document.title, 'Original title');
	assert.ok(result.startsWith('<!DOCTYPE html>'));
	dom.window.close();
});

test('trimmed chunk boundaries and split inline IDs are restored safely', async () => {
	const input = `<p> <a id="long" href="/">${'Hello world. '.repeat(350)}</a> </p>`;
	const result = await translateHtml(
		input,
		async (config) => texts(config).map((text) => text.trim()),
		options,
	);
	const dom = new JSDOM(result);
	assert.equal(
		dom.window.document.querySelector('p').textContent,
		` ${'Hello world. '.repeat(350)} `,
	);
	assert.equal(dom.window.document.querySelectorAll('#long').length, 1);
	dom.window.close();
});

test('node execution evaluates each item and preserves binary data and pairing', async () => {
	const { LanguageDetect } = require('../dist/nodes/LanguageDetect/LanguageDetect.node');
	const node = new LanguageDetect();
	const items = [
		{ json: { source: 'a' }, binary: { file: { data: 'test' } } },
		{ json: { source: 'b' } },
	];
	const context = {
		getInputData: () => items,
		getNode: () => ({
			name: 'Language Detect',
			type: 'languageDetect',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getNodeParameter: (name, index) =>
			({
				options: {},
				inputType: 'text',
				text:
					index === 0
						? 'This is a long English article about the history of science and modern technology.'
						: '这是一篇中文文章，介绍科学技术的发展以及它对日常生活的影响。',
			})[name],
		continueOnFail: () => false,
	};
	const [output] = await node.execute.call(context);
	assert.deepEqual(
		output.map((item) => item.json.language),
		['en', 'zh'],
	);
	assert.equal(output[0].json.source, 'a');
	assert.equal(output[0].binary, items[0].binary);
	assert.deepEqual(output[1].pairedItem, { item: 1 });
});

test('translation node surfaces request errors per item with continue-on-fail', async () => {
	const { HtmlTranslate } = require('../dist/nodes/HtmlTranslate/HtmlTranslate.node');
	const node = new HtmlTranslate();
	const context = {
		getInputData: () => [{ json: { id: 1 } }, { json: { id: 2 } }],
		getNode: () => ({
			name: 'HTML Translate',
			type: 'htmlTranslate',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getNodeParameter: (name) =>
			({
				options: {},
				html: '<p>Hello world</p>',
				sourceLanguage: 'en',
				targetLanguage: 'zh-CN',
				provider: 'google',
				bilingual: false,
			})[name],
		helpers: {
			httpRequest: async () => {
				throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
			},
		},
		continueOnFail: () => true,
	};
	const [output] = await node.execute.call(context);
	assert.equal(output.length, 2);
	assert.ok(output[0].error);
	assert.equal(output[0].error.name, 'NodeApiError');
	assert.equal(output[1].error.context.itemIndex, 1);
	assert.deepEqual(output[1].pairedItem, { item: 1 });
	assert.ok(!('translatedHtml' in output[0].json));
});
