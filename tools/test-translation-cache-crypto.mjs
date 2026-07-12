import { randomBytes } from 'node:crypto';
import {
  decryptTranslationCacheRecord,
  encryptTranslationCacheRecord
} from '../dist-electron/translation-cache-crypto.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const key = randomBytes(32);
const aad = Buffer.from('suite/profile/contact/chunk-000001.dfc');
const entry = {
  sourceHash: 'source-hash',
  sourceText: 'Payment account 123456789',
  translatedText: '收款账号 123456789',
  updatedAt: Date.now()
};
const encrypted = encryptTranslationCacheRecord(key, aad, entry);
const serialized = JSON.stringify(encrypted);
assert(!serialized.includes(entry.sourceText), 'Encrypted cache leaked source text.');
assert(!serialized.includes(entry.translatedText), 'Encrypted cache leaked translated text.');

const decrypted = decryptTranslationCacheRecord(key, aad, encrypted);
assert(JSON.stringify(decrypted) === JSON.stringify(entry), 'Encrypted cache round trip changed the entry.');

let tamperRejected = false;
try {
  decryptTranslationCacheRecord(key, Buffer.from('different-scope'), encrypted);
} catch {
  tamperRejected = true;
}
assert(tamperRejected, 'Encrypted cache accepted the wrong scope binding.');

tamperRejected = false;
try {
  decryptTranslationCacheRecord(randomBytes(32), aad, encrypted);
} catch {
  tamperRejected = true;
}
assert(tamperRejected, 'Encrypted cache accepted the wrong machine key.');

console.log('translation-cache-crypto: confidentiality and tamper checks passed');
