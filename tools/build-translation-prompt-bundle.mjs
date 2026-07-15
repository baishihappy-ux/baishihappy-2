import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptTranslationPromptBundle } from '../dist-electron/translation-prompt-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'config', 'translation-prompts.default.json');
const secretPath = path.join(root, '.package-secrets', 'trial-config.json');
const outputPath = path.join(root, '.package-secrets', 'translation-prompts.dfp');

const source = JSON.parse((await fs.readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, ''));
const secretFile = JSON.parse((await fs.readFile(secretPath, 'utf8')).replace(/^\uFEFF/, ''));
const secret = typeof secretFile.deepseekApiKey === 'string' ? secretFile.deepseekApiKey : '';
const encrypted = encryptTranslationPromptBundle(secret, source);
await fs.writeFile(outputPath, encrypted, { encoding: 'utf8', mode: 0o600 });
console.log(`Encrypted prompt bundle generated: ${path.basename(outputPath)}`);
