import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  verify
} from 'node:crypto';

export const licenseFormatVersion = 2;
export const licenseCodePrefix = 'MYLIC2';
export const machineCodePrefix = 'MYM2';
export const licenseSuiteProductId = 'maoyi';
export const licenseSuiteIssuerId = 'maoyi-offline-issuer';

export type LicenseSuitePublicConfig = {
  suiteId: string;
  issuerId: string;
  productId: string;
  keyId: string;
  publicKeyPem: string;
};

export type LicenseSuitePrivateConfig = LicenseSuitePublicConfig & {
  privateKeyPem: string;
  publicKeySha256: string;
  privateKeySha256: string;
  createdAt: string;
};

export type MachineCodePayload = {
  version: 2;
  productId: string;
  suiteId: string;
  hardwareHash: string;
  encryptionPublicKey: string;
};

export type LicenseIssueRequest = {
  suite: LicenseSuitePrivateConfig;
  machineCode: string;
  username: string;
  serviceSecret: string;
  authorizedDays: number;
  issuedAt?: number;
  features?: string[];
};

export type LicensePayload = {
  version: number;
  licenseId: string;
  suiteId: string;
  issuerId: string;
  productId: string;
  keyId: string;
  machineCodeHash: string;
  username: string;
  serviceSecret: string;
  issuedAt: string;
  effectiveAt: string;
  expiresAt: string;
  authorizedDays: number;
  features: string[];
};

export type LicenseEnvelope = {
  version: number;
  alg: 'Ed25519';
  enc: 'X25519-HKDF-SHA256+A256GCM';
  suiteId: string;
  issuerId: string;
  productId: string;
  keyId: string;
  ephemeralPublicKey: string;
  salt: string;
  iv: string;
  ciphertext: string;
  tag: string;
  signature: string;
};

export type LicenseVerificationRequest = {
  code: string;
  suite: LicenseSuitePublicConfig;
  machineCode: string;
  username: string;
  deviceEncryptionPrivateKeyPem: string;
  now?: number;
};

export type LicenseVerificationResult = {
  ok: boolean;
  reason?: string;
  payload?: LicensePayload;
};

function base64UrlEncode(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url');
}

export function sha256Hex(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeMachineCode(value: string) {
  return value.trim().replace(/\s+/g, '');
}

export function normalizeUsername(value: string) {
  return value.trim();
}

export function createMachineCode(input: {
  suiteId: string;
  hardwareHash: string;
  encryptionPublicKeyPem: string;
}) {
  if (!/^\d{9}$/.test(input.suiteId)) throw new Error('套装 ID 格式无效');
  if (!/^[a-f0-9]{64}$/i.test(input.hardwareHash)) throw new Error('硬件摘要格式无效');
  const publicKey = createPublicKey(input.encryptionPublicKeyPem);
  if (publicKey.asymmetricKeyType !== 'x25519') throw new Error('设备加密公钥类型无效');
  const payload: MachineCodePayload = {
    version: 2,
    productId: licenseSuiteProductId,
    suiteId: input.suiteId,
    hardwareHash: input.hardwareHash.toLowerCase(),
    encryptionPublicKey: base64UrlEncode(publicKey.export({ type: 'spki', format: 'der' }))
  };
  return `${machineCodePrefix}.${base64UrlEncode(JSON.stringify(payload))}`;
}

export function parseMachineCode(value: string): MachineCodePayload {
  const normalized = normalizeMachineCode(value);
  if (!normalized.startsWith(`${machineCodePrefix}.`) || normalized.length > 4096) {
    throw new Error('本机码格式不正确');
  }
  const payload = JSON.parse(base64UrlDecode(normalized.slice(machineCodePrefix.length + 1)).toString('utf8')) as MachineCodePayload;
  if (
    payload.version !== 2 ||
    payload.productId !== licenseSuiteProductId ||
    !/^\d{9}$/.test(payload.suiteId) ||
    !/^[a-f0-9]{64}$/i.test(payload.hardwareHash) ||
    base64UrlDecode(payload.encryptionPublicKey || '').length > 256
  ) throw new Error('本机码内容无效');
  const key = createPublicKey({ key: base64UrlDecode(payload.encryptionPublicKey), type: 'spki', format: 'der' });
  if (key.asymmetricKeyType !== 'x25519') throw new Error('本机码设备公钥无效');
  return payload;
}

export function createLicenseId(suiteId: string) {
  return `lic_${suiteId}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

export function createKeyId(suiteId: string) {
  return `k_${suiteId}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

export function generateSuiteKeyPair(suiteId: string): LicenseSuitePrivateConfig {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    suiteId,
    issuerId: licenseSuiteIssuerId,
    productId: licenseSuiteProductId,
    keyId: createKeyId(suiteId),
    publicKeyPem,
    privateKeyPem,
    publicKeySha256: sha256Hex(publicKeyPem),
    privateKeySha256: sha256Hex(privateKeyPem),
    createdAt: new Date().toISOString()
  };
}

function licenseKdfInfo(suite: Pick<LicenseSuitePublicConfig, 'suiteId' | 'issuerId' | 'productId' | 'keyId'>) {
  return Buffer.from(JSON.stringify([
    'maoyi-license-envelope-v2',
    suite.suiteId,
    suite.issuerId,
    suite.productId,
    suite.keyId
  ]));
}

function deriveLicenseEncryptionKey(sharedSecret: Buffer, salt: Buffer, suite: LicenseSuitePublicConfig) {
  return Buffer.from(hkdfSync('sha256', sharedSecret, salt, licenseKdfInfo(suite), 32));
}

function envelopeAad(envelope: Pick<LicenseEnvelope, 'version' | 'alg' | 'enc' | 'suiteId' | 'issuerId' | 'productId' | 'keyId' | 'ephemeralPublicKey' | 'salt'>) {
  return Buffer.from(JSON.stringify([
    'maoyi-license-aad-v2',
    envelope.version,
    envelope.alg,
    envelope.enc,
    envelope.suiteId,
    envelope.issuerId,
    envelope.productId,
    envelope.keyId,
    envelope.ephemeralPublicKey,
    envelope.salt
  ]));
}

function canonicalEnvelopeForSignature(envelope: Omit<LicenseEnvelope, 'signature'>) {
  return JSON.stringify({
    version: envelope.version,
    alg: envelope.alg,
    enc: envelope.enc,
    suiteId: envelope.suiteId,
    issuerId: envelope.issuerId,
    productId: envelope.productId,
    keyId: envelope.keyId,
    ephemeralPublicKey: envelope.ephemeralPublicKey,
    salt: envelope.salt,
    iv: envelope.iv,
    ciphertext: envelope.ciphertext,
    tag: envelope.tag
  });
}

export function issueLicenseCode(request: LicenseIssueRequest) {
  const machineCode = normalizeMachineCode(request.machineCode);
  const machine = parseMachineCode(machineCode);
  const username = normalizeUsername(request.username);
  if (machine.suiteId !== request.suite.suiteId) throw new Error('本机码与套装 ID 不匹配');
  if (!username) throw new Error('用户名不能为空');
  if (!request.serviceSecret.trim()) throw new Error('密钥不能为空');
  if (!Number.isInteger(request.authorizedDays) || request.authorizedDays <= 0) throw new Error('授权天数必须大于 0');

  const issuedAtMs = request.issuedAt ?? Date.now();
  const expiresAtMs = issuedAtMs + request.authorizedDays * 24 * 60 * 60 * 1000;
  const payload: LicensePayload = {
    version: licenseFormatVersion,
    licenseId: createLicenseId(request.suite.suiteId),
    suiteId: request.suite.suiteId,
    issuerId: request.suite.issuerId,
    productId: request.suite.productId,
    keyId: request.suite.keyId,
    machineCodeHash: sha256Hex(machineCode),
    username,
    serviceSecret: request.serviceSecret.trim(),
    issuedAt: new Date(issuedAtMs).toISOString(),
    effectiveAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    authorizedDays: request.authorizedDays,
    features: request.features ?? ['chat-translation']
  };

  const devicePublicKey = createPublicKey({ key: base64UrlDecode(machine.encryptionPublicKey), type: 'spki', format: 'der' });
  const ephemeral = generateKeyPairSync('x25519');
  const sharedSecret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: devicePublicKey });
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const unsignedBase = {
    version: licenseFormatVersion,
    alg: 'Ed25519' as const,
    enc: 'X25519-HKDF-SHA256+A256GCM' as const,
    suiteId: request.suite.suiteId,
    issuerId: request.suite.issuerId,
    productId: request.suite.productId,
    keyId: request.suite.keyId,
    ephemeralPublicKey: base64UrlEncode(ephemeral.publicKey.export({ type: 'spki', format: 'der' })),
    salt: base64UrlEncode(salt)
  };
  const cipher = createCipheriv('aes-256-gcm', deriveLicenseEncryptionKey(sharedSecret, salt, request.suite), iv);
  cipher.setAAD(envelopeAad(unsignedBase));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const unsignedEnvelope: Omit<LicenseEnvelope, 'signature'> = {
    ...unsignedBase,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(ciphertext),
    tag: base64UrlEncode(cipher.getAuthTag())
  };
  const signature = sign(null, Buffer.from(canonicalEnvelopeForSignature(unsignedEnvelope)), request.suite.privateKeyPem);
  const envelope: LicenseEnvelope = { ...unsignedEnvelope, signature: base64UrlEncode(signature) };
  return `${licenseCodePrefix}.${base64UrlEncode(JSON.stringify(envelope))}`;
}

export function parseLicenseCode(code: string): LicenseEnvelope {
  const trimmed = code.trim();
  if (!trimmed.startsWith(`${licenseCodePrefix}.`) || trimmed.length > 32 * 1024) {
    throw new Error('授权码格式不正确');
  }
  return JSON.parse(base64UrlDecode(trimmed.slice(licenseCodePrefix.length + 1)).toString('utf8')) as LicenseEnvelope;
}

export function verifyLicenseCode(request: LicenseVerificationRequest): LicenseVerificationResult {
  try {
    const envelope = parseLicenseCode(request.code);
    if (envelope.version !== licenseFormatVersion) return { ok: false, reason: '授权版本不匹配' };
    if (envelope.alg !== 'Ed25519' || envelope.enc !== 'X25519-HKDF-SHA256+A256GCM') return { ok: false, reason: '授权算法不匹配' };
    if (envelope.suiteId !== request.suite.suiteId) return { ok: false, reason: '套装 ID 不匹配' };
    if (envelope.issuerId !== request.suite.issuerId) return { ok: false, reason: '签发方不匹配' };
    if (envelope.productId !== request.suite.productId) return { ok: false, reason: '产品不匹配' };
    if (envelope.keyId !== request.suite.keyId) return { ok: false, reason: '密钥 ID 不匹配' };

    const { signature, ...unsignedEnvelope } = envelope;
    const signatureOk = verify(
      null,
      Buffer.from(canonicalEnvelopeForSignature(unsignedEnvelope)),
      request.suite.publicKeyPem,
      base64UrlDecode(signature)
    );
    if (!signatureOk) return { ok: false, reason: '授权签名无效' };

    const ephemeralPublicKey = createPublicKey({ key: base64UrlDecode(envelope.ephemeralPublicKey), type: 'spki', format: 'der' });
    const devicePrivateKey = createPrivateKey(request.deviceEncryptionPrivateKeyPem);
    if (ephemeralPublicKey.asymmetricKeyType !== 'x25519' || devicePrivateKey.asymmetricKeyType !== 'x25519') {
      return { ok: false, reason: '设备加密密钥类型无效' };
    }
    const salt = base64UrlDecode(envelope.salt);
    const iv = base64UrlDecode(envelope.iv);
    const tag = base64UrlDecode(envelope.tag);
    if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16) return { ok: false, reason: '授权加密参数无效' };
    const sharedSecret = diffieHellman({ privateKey: devicePrivateKey, publicKey: ephemeralPublicKey });
    const decipher = createDecipheriv('aes-256-gcm', deriveLicenseEncryptionKey(sharedSecret, salt, request.suite), iv);
    decipher.setAAD(envelopeAad(envelope));
    decipher.setAuthTag(tag);
    const payload = JSON.parse(
      Buffer.concat([decipher.update(base64UrlDecode(envelope.ciphertext)), decipher.final()]).toString('utf8')
    ) as LicensePayload;

    if (
      payload.version !== licenseFormatVersion ||
      payload.suiteId !== envelope.suiteId ||
      payload.issuerId !== envelope.issuerId ||
      payload.productId !== envelope.productId ||
      payload.keyId !== envelope.keyId
    ) return { ok: false, reason: '授权载荷绑定无效' };
    if (payload.machineCodeHash !== sha256Hex(normalizeMachineCode(request.machineCode))) {
      return { ok: false, reason: '本机码不匹配' };
    }
    if (payload.username !== normalizeUsername(request.username)) return { ok: false, reason: '用户名不匹配' };
    if ((request.now ?? Date.now()) > Date.parse(payload.expiresAt)) return { ok: false, reason: '授权已过期' };
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '授权校验失败' };
  }
}
