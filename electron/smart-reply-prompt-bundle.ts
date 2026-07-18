import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from 'crypto';

export const smartReplyPromptBundleFileName = 'smart-reply-prompt.dfp';

const bundleVersion = 1;
const bundleAad = Buffer.from('MAOYI-SMART-REPLY-PROMPT-V1', 'utf8');
const keyInfo = Buffer.from('maoyi-smart-reply-prompt-bundle-key-v1', 'utf8');
const maxPromptLength = 24_000;
const maxBundleLength = 192 * 1024;

export type SmartReplyPrompt = {
  prompt: string;
};

type SmartReplyPromptPayload = SmartReplyPrompt & {
  schemaVersion: 1;
  generatedAt: string;
  prompt: string;
};

export type EncryptedSmartReplyPromptBundle = {
  schemaVersion: 1;
  algorithm: 'AES-256-GCM';
  kdf: 'HKDF-SHA256';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

function validateSecret(secret: string) {
  if (typeof secret !== 'string' || secret.trim().length < 16 || secret.length > 4096) {
    throw new Error('DeepSeek 密钥无效');
  }
  return secret.trim();
}

export function validateSmartReplyPrompt(value: unknown) {
  if (typeof value !== 'string') throw new Error('智能回复提示词无效');
  const normalized = value.replace(/^\uFEFF/, '').trim();
  if (!normalized || normalized.length > maxPromptLength) throw new Error('智能回复提示词长度无效');
  if (/__DF_LOCKED_[0-9a-f]+_\d+__/i.test(normalized)) {
    throw new Error('智能回复提示词不能包含真实运行时占位符');
  }
  return normalized;
}

function deriveKey(secret: string, salt: Buffer) {
  const secretBytes = Buffer.from(validateSecret(secret), 'utf8');
  try {
    return Buffer.from(hkdfSync('sha256', secretBytes, salt, keyInfo, 32));
  } finally {
    secretBytes.fill(0);
  }
}

export function encryptSmartReplyPromptBundle(
  secret: string,
  smartReplyPrompt: SmartReplyPrompt,
  generatedAt = new Date().toISOString()
) {
  const payload: SmartReplyPromptPayload = {
    schemaVersion: 1,
    generatedAt,
    prompt: validateSmartReplyPrompt(smartReplyPrompt?.prompt)
  };
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveKey(secret, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(bundleAad);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ]);
    const bundle: EncryptedSmartReplyPromptBundle = {
      schemaVersion: bundleVersion,
      algorithm: 'AES-256-GCM',
      kdf: 'HKDF-SHA256',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
    return `${JSON.stringify(bundle)}\n`;
  } finally {
    key.fill(0);
  }
}

export function decryptSmartReplyPromptBundle(secret: string, raw: string) {
  if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > maxBundleLength) {
    throw new Error('智能回复提示词文件大小或格式无效');
  }
  let bundle: EncryptedSmartReplyPromptBundle;
  try {
    bundle = JSON.parse(raw) as EncryptedSmartReplyPromptBundle;
  } catch {
    throw new Error('智能回复提示词文件格式无效');
  }
  if (
    bundle?.schemaVersion !== bundleVersion ||
    bundle.algorithm !== 'AES-256-GCM' ||
    bundle.kdf !== 'HKDF-SHA256'
  ) throw new Error('智能回复提示词文件版本或算法无效');

  const salt = Buffer.from(bundle.salt || '', 'base64');
  const iv = Buffer.from(bundle.iv || '', 'base64');
  const tag = Buffer.from(bundle.tag || '', 'base64');
  const ciphertext = Buffer.from(bundle.ciphertext || '', 'base64');
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > maxBundleLength) {
    throw new Error('智能回复提示词文件加密参数无效');
  }
  const key = deriveKey(secret, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(bundleAad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext) as SmartReplyPromptPayload;
    if (payload?.schemaVersion !== 1 || typeof payload.generatedAt !== 'string') {
      throw new Error('智能回复提示词内容版本无效');
    }
    return { prompt: validateSmartReplyPrompt(payload.prompt) } satisfies SmartReplyPrompt;
  } catch (error) {
    if (error instanceof Error && /智能回复提示词/.test(error.message)) throw error;
    throw new Error('智能回复提示词文件与当前 DeepSeek 密钥不匹配，或文件已损坏');
  } finally {
    key.fill(0);
  }
}
