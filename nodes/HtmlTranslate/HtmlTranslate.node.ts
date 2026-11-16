import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	JsonObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { translateHtml } from './html';
import { TranslationRequestError } from './transport';
import type { Provider } from './transport';
export class HtmlTranslate implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTML Translate',
		name: 'htmlTranslate',
		icon: { light: 'file:languages.light.svg', dark: 'file:languages.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: "={{ $parameter.provider + ': ' + $parameter.targetLanguage }}",
		description: 'Translate HTML with Google or Microsoft and optional bilingual output',
		defaults: { name: 'HTML Translate' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'HTML',
				name: 'html',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Provider',
				name: 'provider',
				type: 'options',
				options: [
					{
						name: 'Google',
						value: 'google',
					},
					{
						name: 'Microsoft',
						value: 'microsoft',
					},
				],
				default: 'google',
			},
			{
				displayName: 'Source Language',
				name: 'sourceLanguage',
				type: 'string',
				default: 'auto',
				description: 'Language code, such as en, or auto for service-side detection',
			},
			{
				displayName: 'Target Language',
				name: 'targetLanguage',
				type: 'string',
				default: 'zh-CN',
				required: true,
				description: 'Language code, such as en, zh-CN, or zh-TW',
			},
			{
				displayName: 'Bilingual',
				name: 'bilingual',
				type: 'boolean',
				default: false,
				description: 'Whether to retain original text and append translations within each block',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Output Field',
						name: 'outputField',
						type: 'string',
						default: 'translatedHtml',
						description: 'Top-level field to store the resulting HTML',
					},
				],
			},
		],
	};
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		for (let index = 0; index < items.length; index++) {
			const item = items[index];
			try {
				const options = this.getNodeParameter('options', index, {}) as { outputField?: string };
				const field = options.outputField?.trim() || 'translatedHtml';
				const source = (this.getNodeParameter('sourceLanguage', index) as string).trim();
				const target = (this.getNodeParameter('targetLanguage', index) as string).trim();
				if (!source || !target || target === 'auto')
					throw new NodeOperationError(
						this.getNode(),
						'Provide a source language or auto and a target language code',
						{ itemIndex: index },
					);
				const result = await translateHtml(
					this.getNodeParameter('html', index) as string,
					this.helpers.httpRequest,
					{
						provider: this.getNodeParameter('provider', index) as Provider,
						source,
						target,
						bilingual: this.getNodeParameter('bilingual', index) as boolean,
					},
				);
				output.push({
					json: { ...item.json, [field]: result },
					binary: item.binary,
					pairedItem: { item: index },
				});
			} catch (error) {
				const failure =
					error instanceof TranslationRequestError
						? new NodeApiError(this.getNode(), error.cause as JsonObject, { itemIndex: index })
						: new NodeOperationError(this.getNode(), error as Error, { itemIndex: index });
				if (!this.continueOnFail()) throw failure;
				output.push({
					json: { ...item.json, error: failure.message },
					binary: item.binary,
					error: failure,
					pairedItem: { item: index },
				});
			}
		}
		return [output];
	}
}
