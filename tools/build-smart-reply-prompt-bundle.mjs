import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptSmartReplyPromptBundle } from '../dist-electron/smart-reply-prompt-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, '.package-secrets', 'smart-reply-prompt.source.txt');
const secretPath = path.join(root, '.package-secrets', 'trial-config.json');
const outputPath = path.join(root, '.package-secrets', 'smart-reply-prompt.dfp');

const source = (await fs.readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, '');
const secretFile = JSON.parse((await fs.readFile(secretPath, 'utf8')).replace(/^\uFEFF/, ''));
const secret = typeof secretFile.deepseekApiKey === 'string' ? secretFile.deepseekApiKey : '';
const encrypted = encryptSmartReplyPromptBundle(secret, { prompt: source });
await fs.writeFile(outputPath, encrypted, { encoding: 'utf8', mode: 0o600 });
console.log(`Encrypted smart-reply prompt bundle generated: ${path.basename(outputPath)}`);
