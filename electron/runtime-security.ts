import { app, safeStorage } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  createSignalInstanceBinding,
  runtimeSecurityProductId,
  runtimeSecuritySchemaVersion,
  signRuntimeBindingPayload,
  validateRuntimeBindingPayload,
  verifySignalInstanceBinding,
  verifySignedRuntimeBinding,
  type ProtectedRuntimeBindingFile,
  type RuntimeBindingPayload,
  type SignalInstanceBinding
} from './runtime-security-core.js';

export const runtimeBindingFileName = 'runtime-binding.dat';
export const signalInstanceBindingFileName = 'df-instance-binding.dat';

export type RuntimeSecurityMaterial = {
  suiteId: string;
  keyId: string;
  machineCodeHash: string;
  hardwareHash: string;
  devicePublicKeyPem: string;
  devicePrivateKeyPem: string;
};

export type RuntimeBindingInspection =
  | { state: 'missing' }
  | { state: 'local'; file: ProtectedRuntimeBindingFile; payload: RuntimeBindingPayload }
  | { state: 'foreign'; file?: ProtectedRuntimeBindingFile; reason: string };

async function writeFileAtomic(path: string, value: string | Buffer) {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, value);
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(path, { force: true });
    await rename(tempPath, path);
    void error;
  }
}

function validateProtectedFile(file: ProtectedRuntimeBindingFile) {
  if (
    file.schemaVersion !== runtimeSecuritySchemaVersion ||
    file.productId !== runtimeSecurityProductId ||
    !file.suiteId ||
    !file.keyId ||
    !file.installationId ||
    !file.dataRootId ||
    !file.signedPayload ||
    !file.signature ||
    !file.protectedPayload
  ) {
    throw new Error('Runtime binding file is invalid.');
  }
  return file;
}

export async function inspectRuntimeBinding(
  path: string,
  expected?: Partial<RuntimeSecurityMaterial>
): Promise<RuntimeBindingInspection> {
  let raw = '';
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return { state: 'missing' };
    return { state: 'foreign', reason: 'Runtime binding could not be read.' };
  }

  let file: ProtectedRuntimeBindingFile | undefined;
  try {
    file = validateProtectedFile(JSON.parse(raw) as ProtectedRuntimeBindingFile);
    const signedPayload = verifySignedRuntimeBinding(file);
    if (!safeStorage.isEncryptionAvailable()) {
      return { state: 'foreign', file, reason: 'Windows DPAPI is unavailable.' };
    }
    const protectedPayload = validateRuntimeBindingPayload(JSON.parse(
      safeStorage.decryptString(Buffer.from(file.protectedPayload, 'base64'))
    ) as RuntimeBindingPayload);
    if (JSON.stringify(signedPayload) !== JSON.stringify(protectedPayload)) {
      return { state: 'foreign', file, reason: 'Runtime binding protected and signed payloads do not match.' };
    }
    if (expected?.suiteId && signedPayload.suiteId !== expected.suiteId) {
      return { state: 'foreign', file, reason: 'Runtime binding suite does not match this client.' };
    }
    if (expected?.keyId && signedPayload.keyId !== expected.keyId) {
      return { state: 'foreign', file, reason: 'Runtime binding key does not match this client.' };
    }
    if (expected?.machineCodeHash && signedPayload.machineCodeHash !== expected.machineCodeHash) {
      return { state: 'foreign', file, reason: 'Runtime binding belongs to another machine.' };
    }
    if (expected?.hardwareHash && signedPayload.hardwareHash !== expected.hardwareHash) {
      return { state: 'foreign', file, reason: 'Runtime binding hardware does not match this machine.' };
    }
    if (expected?.devicePublicKeyPem && signedPayload.devicePublicKeyPem !== expected.devicePublicKeyPem) {
      return { state: 'foreign', file, reason: 'Runtime binding device key does not match this client.' };
    }
    return { state: 'local', file, payload: signedPayload };
  } catch {
    return { state: 'foreign', file, reason: 'Runtime binding cannot be verified on this machine.' };
  }
}

export async function createRuntimeBinding(path: string, material: RuntimeSecurityMaterial) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows DPAPI is unavailable.');
  const payload: RuntimeBindingPayload = {
    schemaVersion: runtimeSecuritySchemaVersion,
    productId: runtimeSecurityProductId,
    suiteId: material.suiteId,
    keyId: material.keyId,
    installationId: randomUUID(),
    dataRootId: randomUUID(),
    machineCodeHash: material.machineCodeHash,
    hardwareHash: material.hardwareHash,
    devicePublicKeyPem: material.devicePublicKeyPem,
    createdAt: new Date().toISOString()
  };
  const signed = signRuntimeBindingPayload(payload, material.devicePrivateKeyPem);
  const file: ProtectedRuntimeBindingFile = {
    schemaVersion: runtimeSecuritySchemaVersion,
    productId: runtimeSecurityProductId,
    suiteId: payload.suiteId,
    keyId: payload.keyId,
    installationId: payload.installationId,
    dataRootId: payload.dataRootId,
    ...signed,
    protectedPayload: safeStorage.encryptString(JSON.stringify(payload)).toString('base64')
  };
  await writeFileAtomic(path, `${JSON.stringify(file)}\n`);
  return { file, payload };
}

export async function ensureRuntimeBinding(path: string, material: RuntimeSecurityMaterial) {
  const existing = await inspectRuntimeBinding(path, material);
  if (existing.state === 'local') return existing;
  if (existing.state === 'foreign') throw new Error(existing.reason);
  const created = await createRuntimeBinding(path, material);
  return { state: 'local', ...created } as const;
}

export async function mirrorRuntimeBinding(sourcePath: string, targetPath: string) {
  const raw = await readFile(sourcePath);
  await writeFileAtomic(targetPath, raw);
}

export async function ensureSignalInstanceBinding(
  dataDir: string,
  profileId: string,
  runtimeBinding: RuntimeBindingPayload,
  devicePrivateKeyPem: string
) {
  const path = join(dataDir, signalInstanceBindingFileName);
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as SignalInstanceBinding;
    if (verifySignalInstanceBinding(existing, runtimeBinding, profileId)) return existing;
  } catch {
    // Missing and legacy profiles are bound by the authorized launcher before Signal starts.
  }
  const binding = createSignalInstanceBinding(runtimeBinding, profileId, devicePrivateKeyPem);
  await writeFileAtomic(path, `${JSON.stringify(binding)}\n`);
  return binding;
}

export function defaultRuntimeBindingPath() {
  return join(app.getPath('userData'), runtimeBindingFileName);
}
