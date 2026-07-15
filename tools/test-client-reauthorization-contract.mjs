import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decryptTranslationPromptBundle,
  encryptTranslationPromptBundle
} from '../dist-electron/translation-prompt-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appSource = fs.readFileSync(path.join(root, 'src', 'App.vue'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8');
const licenseSource = fs.readFileSync(path.join(root, 'electron', 'client-license.ts'), 'utf8');

assert.match(appSource, /activePanel === 'account'[\s\S]{0,600}重新授权/);
assert.match(appSource, /reauthorizationDialogOpen[\s\S]{0,1800}<span>本机码<\/span>[\s\S]*<span>用户名<\/span>[\s\S]*<span>授权码<\/span>/);
assert.match(appSource, /copyReauthorizationMachineInfo/);
assert.match(appSource, /replaceClientLicense/);
assert.doesNotMatch(
  appSource.match(/activePanel === 'account'[\s\S]{0,700}/)?.[0] || '',
  /expiresAt|suiteId|授权有效期|套装编号/
);

const prepareIndex = mainSource.indexOf('prepareReplacement(');
const pendingIndex = mainSource.indexOf('pendingTranslationPromptPath(), pendingRaw', prepareIndex);
const commitIndex = mainSource.indexOf('commitReplacement(', prepareIndex);
const promoteIndex = mainSource.indexOf('activeTranslationPromptPath(), pendingRaw', commitIndex);
assert.ok(prepareIndex >= 0 && pendingIndex > prepareIndex && commitIndex > pendingIndex && promoteIndex > commitIndex);
assert.match(mainSource, /rollbackReplacement\(snapshot\)/);
assert.match(mainSource, /pendingTranslationPromptPath\(\)[\s\S]{0,500}decryptTranslationPromptBundle\(serviceSecret, pendingRaw\)/);
assert.match(licenseSource, /prepareReplacement\([\s\S]*recordAuthorizationFailure\(\)/);

const oldSecret = 'test-secret-old-0123456789abcdef';
const newSecret = 'test-secret-new-0123456789abcdef';
const prompts = { chineseToEnglish: '中译英规则', englishToChinese: '英译中规则' };
const oldBundle = encryptTranslationPromptBundle(oldSecret, prompts);
const currentPrompts = decryptTranslationPromptBundle(oldSecret, oldBundle);
const migratedBundle = encryptTranslationPromptBundle(newSecret, currentPrompts);
assert.deepEqual(decryptTranslationPromptBundle(newSecret, migratedBundle), prompts);
assert.throws(() => decryptTranslationPromptBundle(oldSecret, migratedBundle), /不匹配|损坏/);

console.log('client-reauthorization: UI, non-destructive verification, migration ordering, rollback, and pending recovery contracts passed');
