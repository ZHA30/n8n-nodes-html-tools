import { detect } from 'tinyld';
import { htmlText } from '../shared/html';

export function detectLanguage(input: string, html = true): string {
	const text = html ? htmlText(input) : input;
	return /\p{L}/u.test(text) ? detect(text) || 'und' : 'und';
}
