import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decryptSmartReplyPromptBundle,
  encryptSmartReplyPromptBundle,
  smartReplyPromptBundleFileName
} from '../dist-electron/smart-reply-prompt-bundle.js';
import { encryptTranslationPromptBundle } from '../dist-electron/translation-prompt-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = 'unit-test-smart-reply-secret-1234567890';
const prompt = 'Generate exactly three distinct English chat replies and return strict JSON.';
const encrypted = encryptSmartReplyPromptBundle(secret, { prompt }, '2026-07-16T00:00:00.000Z');
const translationBundle = encryptTranslationPromptBundle(secret, {
  chineseToEnglish: 'translate to English',
  englishToChinese: 'translate to Chinese'
});

assert.equal(smartReplyPromptBundleFileName, 'smart-reply-prompt.dfp');
assert.equal(encrypted.includes(prompt), false);
assert.deepEqual(decryptSmartReplyPromptBundle(secret, encrypted), { prompt });
assert.throws(() => decryptSmartReplyPromptBundle(secret, translationBundle));
assert.throws(() => decryptSmartReplyPromptBundle(`${secret}-wrong`, encrypted), /DeepSeek|智能回复提示词/);

const tampered = JSON.parse(encrypted);
tampered.ciphertext = `${tampered.ciphertext.slice(0, -4)}AAAA`;
assert.throws(() => decryptSmartReplyPromptBundle(secret, JSON.stringify(tampered)), /智能回复提示词/);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const clientSuiteBuilder = fs.readFileSync(path.join(root, 'electron-builder.client-suite.cjs'), 'utf8');
const promptGeneratorBuilder = fs.readFileSync(path.join(root, 'electron-builder.prompt-generator.cjs'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'tools', 'build-smart-reply-prompt-bundle.mjs'), 'utf8');
const approvedSourcePath = path.join(root, '.package-secrets', 'smart-reply-prompt.source.txt');

assert.ok(packageJson.build.files.includes('dist-electron/smart-reply-prompt-bundle.js'));
assert.ok(packageJson.build.extraResources.some((entry) => entry.from === '.package-secrets/smart-reply-prompt.dfp' && entry.to === 'smart-reply-prompt.dfp'));
assert.match(clientSuiteBuilder, /dist-electron\/smart-reply-prompt-bundle\.js/);
assert.match(clientSuiteBuilder, /\.package-secrets\/smart-reply-prompt\.dfp/);
assert.doesNotMatch(promptGeneratorBuilder, /smart-reply-prompt/i);
assert.match(buildScript, /smart-reply-prompt\.source\.txt/);
assert.match(buildScript, /smart-reply-prompt\.dfp/);
if (fs.existsSync(approvedSourcePath)) {
  const approvedSource = fs.readFileSync(approvedSourcePath, 'utf8').replace(/^\uFEFF/, '');
  assert.match(approvedSource, /三条回复都必须包含完整的“接、化、抛”/);
  assert.match(approvedSource, /每条回复必须同时返回 english 和 chinese/);
  assert.match(approvedSource, /df\.smart_reply\.output\.v1/);
  assert.doesNotMatch(approvedSource, /reply_1 对应 continue|reply_2 对应 expand|reply_3 对应 opinion/);
  const localSecretPath = path.join(root, '.package-secrets', 'trial-config.json');
  const localBundlePath = path.join(root, '.package-secrets', smartReplyPromptBundleFileName);
  if (fs.existsSync(localSecretPath) && fs.existsSync(localBundlePath)) {
    const localSecret = JSON.parse(fs.readFileSync(localSecretPath, 'utf8').replace(/^\uFEFF/, '')).deepseekApiKey;
    const localBundle = fs.readFileSync(localBundlePath, 'utf8');
    assert.equal(decryptSmartReplyPromptBundle(localSecret, localBundle).prompt, approvedSource.trim());
  }
}

console.log('smart-reply-prompt-bundle: encryption, isolation, tamper rejection, and client packaging contracts passed');
