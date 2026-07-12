import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type EncryptedTranslationCacheRecord = {
  version: 3;
  iv: string;
  ciphertext: string;
  tag: string;
};

export function encryptTranslationCacheRecord(key: Buffer, aad: Buffer, value: unknown): EncryptedTranslationCacheRecord {
  if (key.length !== 32) throw new Error('Translation cache key must be 256 bits.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    version: 3,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}

export function decryptTranslationCacheRecord<T>(key: Buffer, aad: Buffer, record: EncryptedTranslationCacheRecord): T {
  if (key.length !== 32 || record.version !== 3) throw new Error('Translation cache encryption parameters are invalid.');
  const iv = Buffer.from(record.iv || '', 'base64url');
  const tag = Buffer.from(record.tag || '', 'base64url');
  const ciphertext = Buffer.from(record.ciphertext || '', 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 128 * 1024) {
    throw new Error('Translation cache record parameters are invalid.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as T;
}
