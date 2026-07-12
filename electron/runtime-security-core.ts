import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';

export const runtimeSecuritySchemaVersion = 1 as const;
export const runtimeSecurityProductId = 'maoyi';
export const signalLaunchCredentialTtlMs = 10_000;

export type RuntimeBindingPayload = {
  schemaVersion: 1;
  productId: string;
  suiteId: string;
  keyId: string;
  installationId: string;
  dataRootId: string;
  machineCodeHash: string;
  hardwareHash: string;
  devicePublicKeyPem: string;
  createdAt: string;
};

export type ProtectedRuntimeBindingFile = {
  schemaVersion: 1;
  productId: string;
  suiteId: string;
  keyId: string;
  installationId: string;
  dataRootId: string;
  signedPayload: string;
  signature: string;
  protectedPayload: string;
};

export type SignalInstanceBinding = {
  schemaVersion: 1;
  productId: string;
  suiteId: string;
  installationId: string;
  dataRootId: string;
  profileId: string;
  createdAt: string;
  signature: string;
};

export type SignalLaunchCredential = {
  schemaVersion: 1;
  productId: string;
  suiteId: string;
  installationId: string;
  dataRootId: string;
  profileId: string;
  processId: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  controlKey: string;
  signature: string;
};

export type SignalLaunchExpectation = {
  suiteId: string;
  installationId: string;
  dataRootId: string;
  profileId: string;
  processId: number;
};

function assertIdentifier(label: string, value: string, maxLength = 128) {
  if (!value || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function signValues(privateKeyPem: string, values: unknown[]) {
  return sign(null, Buffer.from(JSON.stringify(values)), createPrivateKey(privateKeyPem)).toString('base64url');
}

function verifyValues(publicKeyPem: string, signature: string, values: unknown[]) {
  try {
    return verify(
      null,
      Buffer.from(JSON.stringify(values)),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url')
    );
  } catch {
    return false;
  }
}

export function validateRuntimeBindingPayload(payload: RuntimeBindingPayload) {
  if (payload.schemaVersion !== runtimeSecuritySchemaVersion || payload.productId !== runtimeSecurityProductId) {
    throw new Error('Runtime binding version or product is invalid.');
  }
  assertIdentifier('suiteId', payload.suiteId);
  assertIdentifier('keyId', payload.keyId);
  assertIdentifier('installationId', payload.installationId);
  assertIdentifier('dataRootId', payload.dataRootId);
  if (!/^[a-f0-9]{64}$/i.test(payload.machineCodeHash)) throw new Error('Runtime machine-code hash is invalid.');
  if (!/^[a-f0-9]{64}$/i.test(payload.hardwareHash)) throw new Error('Runtime hardware hash is invalid.');
  if (!payload.devicePublicKeyPem || !Number.isFinite(Date.parse(payload.createdAt))) {
    throw new Error('Runtime binding public key or creation time is invalid.');
  }
  createPublicKey(payload.devicePublicKeyPem);
  return payload;
}

function runtimeBindingSignatureValues(payload: RuntimeBindingPayload) {
  return [
    'maoyi-runtime-binding-v1',
    payload.schemaVersion,
    payload.productId,
    payload.suiteId,
    payload.keyId,
    payload.installationId,
    payload.dataRootId,
    payload.machineCodeHash,
    payload.hardwareHash,
    payload.devicePublicKeyPem,
    payload.createdAt
  ];
}

export function signRuntimeBindingPayload(payload: RuntimeBindingPayload, privateKeyPem: string) {
  const normalized = validateRuntimeBindingPayload(payload);
  return {
    signedPayload: Buffer.from(JSON.stringify(normalized)).toString('base64url'),
    signature: signValues(privateKeyPem, runtimeBindingSignatureValues(normalized))
  };
}

export function verifySignedRuntimeBinding(file: ProtectedRuntimeBindingFile) {
  const payload = validateRuntimeBindingPayload(JSON.parse(
    Buffer.from(file.signedPayload, 'base64url').toString('utf8')
  ) as RuntimeBindingPayload);
  if (
    payload.suiteId !== file.suiteId ||
    payload.keyId !== file.keyId ||
    payload.installationId !== file.installationId ||
    payload.dataRootId !== file.dataRootId ||
    !verifyValues(payload.devicePublicKeyPem, file.signature, runtimeBindingSignatureValues(payload))
  ) {
    throw new Error('Runtime binding signature is invalid.');
  }
  return payload;
}

function instanceSignatureValues(binding: Omit<SignalInstanceBinding, 'signature'>) {
  return [
    'maoyi-signal-instance-v1',
    binding.schemaVersion,
    binding.productId,
    binding.suiteId,
    binding.installationId,
    binding.dataRootId,
    binding.profileId,
    binding.createdAt
  ];
}

export function createSignalInstanceBinding(
  runtimeBinding: RuntimeBindingPayload,
  profileId: string,
  privateKeyPem: string,
  createdAt = new Date().toISOString()
): SignalInstanceBinding {
  assertIdentifier('profileId', profileId);
  const unsigned: Omit<SignalInstanceBinding, 'signature'> = {
    schemaVersion: runtimeSecuritySchemaVersion,
    productId: runtimeSecurityProductId,
    suiteId: runtimeBinding.suiteId,
    installationId: runtimeBinding.installationId,
    dataRootId: runtimeBinding.dataRootId,
    profileId,
    createdAt
  };
  return {
    ...unsigned,
    signature: signValues(privateKeyPem, instanceSignatureValues(unsigned))
  };
}

export function verifySignalInstanceBinding(
  binding: SignalInstanceBinding,
  runtimeBinding: RuntimeBindingPayload,
  profileId: string
) {
  if (
    binding.schemaVersion !== runtimeSecuritySchemaVersion ||
    binding.productId !== runtimeSecurityProductId ||
    binding.suiteId !== runtimeBinding.suiteId ||
    binding.installationId !== runtimeBinding.installationId ||
    binding.dataRootId !== runtimeBinding.dataRootId ||
    binding.profileId !== profileId ||
    !Number.isFinite(Date.parse(binding.createdAt))
  ) {
    return false;
  }
  const { signature, ...unsigned } = binding;
  return verifyValues(runtimeBinding.devicePublicKeyPem, signature, instanceSignatureValues(unsigned));
}

function launchSignatureValues(credential: Omit<SignalLaunchCredential, 'signature'>) {
  return [
    'maoyi-signal-launch-v1',
    credential.schemaVersion,
    credential.productId,
    credential.suiteId,
    credential.installationId,
    credential.dataRootId,
    credential.profileId,
    credential.processId,
    credential.issuedAt,
    credential.expiresAt,
    credential.nonce,
    credential.controlKey
  ];
}

export function createSignalLaunchCredential(
  runtimeBinding: RuntimeBindingPayload,
  profileId: string,
  processId: number,
  privateKeyPem: string,
  now = Date.now()
): SignalLaunchCredential {
  assertIdentifier('profileId', profileId);
  if (!Number.isInteger(processId) || processId <= 0) throw new Error('Signal process ID is invalid.');
  const unsigned: Omit<SignalLaunchCredential, 'signature'> = {
    schemaVersion: runtimeSecuritySchemaVersion,
    productId: runtimeSecurityProductId,
    suiteId: runtimeBinding.suiteId,
    installationId: runtimeBinding.installationId,
    dataRootId: runtimeBinding.dataRootId,
    profileId,
    processId,
    issuedAt: now,
    expiresAt: now + signalLaunchCredentialTtlMs,
    nonce: randomBytes(32).toString('base64url'),
    controlKey: randomBytes(32).toString('base64url')
  };
  return {
    ...unsigned,
    signature: signValues(privateKeyPem, launchSignatureValues(unsigned))
  };
}

export function verifySignalLaunchCredential(
  credential: SignalLaunchCredential,
  runtimeBinding: RuntimeBindingPayload,
  expectation: SignalLaunchExpectation,
  now = Date.now()
) {
  if (
    credential.schemaVersion !== runtimeSecuritySchemaVersion ||
    credential.productId !== runtimeSecurityProductId ||
    credential.suiteId !== expectation.suiteId ||
    credential.installationId !== expectation.installationId ||
    credential.dataRootId !== expectation.dataRootId ||
    credential.profileId !== expectation.profileId ||
    credential.processId !== expectation.processId ||
    !Number.isInteger(credential.issuedAt) ||
    !Number.isInteger(credential.expiresAt) ||
    credential.expiresAt - credential.issuedAt !== signalLaunchCredentialTtlMs ||
    now < credential.issuedAt - 1_000 ||
    now > credential.expiresAt ||
    Buffer.from(credential.nonce || '', 'base64url').length !== 32 ||
    Buffer.from(credential.controlKey || '', 'base64url').length !== 32
  ) {
    return false;
  }
  const { signature, ...unsigned } = credential;
  return verifyValues(runtimeBinding.devicePublicKeyPem, signature, launchSignatureValues(unsigned));
}
