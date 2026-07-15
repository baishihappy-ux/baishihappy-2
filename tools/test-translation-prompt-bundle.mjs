import assert from 'node:assert/strict';
import {
  decryptTranslationPromptBundle,
  encryptTranslationPromptBundle
} from '../dist-electron/translation-prompt-bundle.js';

const secret = 'test-secret-only-0123456789abcdef';
const prompts = {
  chineseToEnglish: '中译英测试规则，只输出译文',
  englishToChinese: '英译中测试规则，只输出译文'
};
const encrypted = encryptTranslationPromptBundle(secret, prompts, '2026-07-14T00:00:00.000Z');
assert.equal(encrypted.includes(prompts.chineseToEnglish), false);
assert.equal(encrypted.includes(prompts.englishToChinese), false);
assert.deepEqual(decryptTranslationPromptBundle(secret, encrypted), prompts);
assert.throws(() => decryptTranslationPromptBundle(`${secret}-wrong`, encrypted), /不匹配|损坏/);

const parsed = JSON.parse(encrypted);
parsed.ciphertext = `${parsed.ciphertext.slice(0, -2)}AA`;
assert.throws(() => decryptTranslationPromptBundle(secret, JSON.stringify(parsed)), /不匹配|损坏|加密参数/);
console.log('translation-prompt-bundle: encryption, wrong-key rejection, and tamper rejection passed');
