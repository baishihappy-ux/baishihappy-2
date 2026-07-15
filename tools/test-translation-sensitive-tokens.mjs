import assert from 'node:assert/strict';
import { base58 } from '@scure/base';

import {
  protectTranslationSensitiveTokens,
  restoreTranslationSensitiveTokens
} from '../dist-electron/translation-sensitive-tokens.js';

const evm = `0x${'12'.repeat(20)}`;
const solana = base58.encode(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
const source = `请将 0012 345678 转到 ${evm}\n备用地址 ${solana}`;
const protection = protectTranslationSensitiveTokens(source, '1234567890abcdef');

assert.equal(protection.tokens.length, 3);
assert.equal(protection.text.includes(evm), false);
assert.equal(protection.text.includes(solana), false);
assert.equal(protection.text.includes('0012 345678'), false);
assert.deepEqual(protection.tokens.map(token => token.kind), ['numeric-account', 'usdt-wallet', 'usdt-wallet']);

const translatedWithPlaceholders = protection.text
  .replace('请将', 'Please send')
  .replace('转到', 'to')
  .replace('备用地址', 'Backup address');
const restored = restoreTranslationSensitiveTokens(translatedWithPlaceholders, protection);
assert.equal(restored.ok, true);
assert.equal(restored.ok && restored.text.includes(evm), true);
assert.equal(restored.ok && restored.text.includes(solana), true);
assert.equal(restored.ok && restored.text.includes('0012 345678'), true);

const missing = restoreTranslationSensitiveTokens(
  translatedWithPlaceholders.replace(protection.tokens[0].placeholder, ''),
  protection
);
assert.equal(missing.ok, false);

const duplicated = restoreTranslationSensitiveTokens(
  `${translatedWithPlaceholders} ${protection.tokens[1].placeholder}`,
  protection
);
assert.equal(duplicated.ok, false);

const ordinary = protectTranslationSensitiveTokens('普通聊天内容 12345', 'abcdef1234567890');
assert.equal(ordinary.tokens.length, 0);
assert.equal(ordinary.text, '普通聊天内容 12345');

const immutable = protectTranslationSensitiveTokens(
  '打开 https://example.com/pay/a-b?x=1 并选择 X-200',
  '0011223344556677'
);
assert.deepEqual(immutable.tokens.map(token => token.kind), ['url', 'literal']);
assert.equal(immutable.text.includes('https://example.com/pay/a-b?x=1'), false);
assert.equal(immutable.text.includes('X-200'), false);
const immutableRestored = restoreTranslationSensitiveTokens(immutable.text, immutable);
assert.equal(immutableRestored.ok, true);
assert.equal(immutableRestored.ok && immutableRestored.text, '打开 https://example.com/pay/a-b?x=1 并选择 X-200');

console.log('translation-sensitive-tokens: mixed payment data masking and exact restoration passed');
