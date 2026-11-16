import type { IHttpRequestOptions } from 'n8n-workflow';

export class TranslationRequestError extends Error {
	constructor(cause: unknown) {
		super('Translation request failed', { cause });
	}
}

export type Provider = 'google' | 'microsoft';
export type Request = (options: IHttpRequestOptions) => Promise<unknown>;
export interface TranslationOptions {
	provider: Provider;
	source: string;
	target: string;
	bilingual: boolean;
}

export function providerLanguage(language: string, provider: Provider): string {
	if (provider === 'microsoft')
		return (
			({ 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' } as Record<string, string>)[language] || language
		);
	return (
		({ 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' } as Record<string, string>)[language] || language
	);
}

export async function translateBatch(
	request: Request,
	texts: string[],
	options: TranslationOptions,
): Promise<string[]> {
	const { provider } = options;
	const source = providerLanguage(options.source, provider);
	const target = providerLanguage(options.target, provider);
	const config: IHttpRequestOptions =
		provider === 'google'
			? {
					method: 'POST',
					url: 'https://translate.googleapis.com/translate_a/t',
					qs: { client: 'dict-chrome-ex', sl: source, tl: target },
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: texts.map((text) => `q=${encodeURIComponent(text)}`).join('&'),
					json: true,
					timeout: 25000,
				}
			: {
					method: 'POST',
					url: 'https://edge.microsoft.com/translate/translatetext',
					qs: {
						isEnterpriseClient: 'false',
						to: target,
						...(source === 'auto' ? {} : { from: source }),
					},
					body: texts,
					json: true,
					timeout: 25000,
				};
	let data: unknown;
	for (let attempt = 0; ; attempt++) {
		try {
			data = await request(config);
			break;
		} catch (error) {
			const failure = error as {
				statusCode?: number;
				response?: { status?: number; statusCode?: number };
				code?: string;
			};
			const status = failure.statusCode || failure.response?.statusCode || failure.response?.status;
			if (
				attempt >= 2 ||
				!(
					status === 429 ||
					(status !== undefined && status >= 500) ||
					['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED'].includes(failure.code || '')
				)
			)
				// The node boundary converts this failure to NodeApiError with item context.
				// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
				throw new TranslationRequestError(error);
			await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
		}
	}
	if (!Array.isArray(data) || data.length !== texts.length)
		throw new Error('Translation response count does not match the request');
	const results: string[] = [];
	for (let index = 0; index < data.length; index++) {
		const value: unknown = data[index];
		const text: unknown =
			provider === 'google'
				? Array.isArray(value)
					? value[0]
					: value
				: (value as { translations?: { text?: unknown }[] })?.translations?.[0]?.text;
		if (typeof text === 'string' && text.trim()) results.push(text);
		else if (texts.length > 1) {
			const [retried] = await translateBatch(request, [texts[index]], options);
			results.push(retried);
		} else throw new Error('Translation service returned an empty or invalid result');
	}
	return results;
}
