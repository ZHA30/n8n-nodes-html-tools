import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { detectLanguage } from './language';
export class LanguageDetect implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Language Detect',
		name: 'languageDetect',
		icon: { light: 'file:languages.light.svg', dark: 'file:languages.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter.inputType }}',
		description: 'Detect the primary language from content without using HTML metadata',
		defaults: { name: 'Language Detect' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Text',
				name: 'text',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				default: '',
				required: true,
			},
			{
				displayName: 'Input Type',
				name: 'inputType',
				type: 'options',
				options: [
					{
						name: 'HTML',
						value: 'html',
					},
					{
						name: 'Plain Text',
						value: 'text',
					},
				],
				default: 'html',
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
						default: 'language',
						description: 'Top-level field to store the language code; und means undetermined',
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
				const field = options.outputField?.trim() || 'language';
				const result = detectLanguage(
					this.getNodeParameter('text', index) as string,
					this.getNodeParameter('inputType', index) === 'html',
				);
				output.push({
					json: { ...item.json, [field]: result },
					binary: item.binary,
					pairedItem: { item: index },
				});
			} catch (error) {
				const failure = new NodeOperationError(this.getNode(), error as Error, {
					itemIndex: index,
				});
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
