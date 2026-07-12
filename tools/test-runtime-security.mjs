import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import {
  createSignalInstanceBinding,
  createSignalLaunchCredential,
  signalLaunchCredentialTtlMs,
  signRuntimeBindingPayload,
  verifySignalInstanceBinding,
  verifySignalLaunchCredential,
  verifySignedRuntimeBinding
} from '../dist-electron/runtime-security-core.js';
import { createCloneResetPlan, runCloneResetWorker } from '../dist-electron/clone-reset.js';

const require = createRequire(import.meta.url);
const signalGuard = require('../signal-guard/df-bootstrap.cjs');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const devicePublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const devicePrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const runtimeBinding = {
  schemaVersion: 1,
  productId: 'maoyi',
  suiteId: '123456789',
  keyId: 'key-test',
  installationId: 'installation-test',
  dataRootId: 'data-root-test',
  machineCodeHash: 'a'.repeat(64),
  hardwareHash: 'b'.repeat(64),
  devicePublicKeyPem,
  createdAt: new Date(1_700_000_000_000).toISOString()
};

const signedRuntime = signRuntimeBindingPayload(runtimeBinding, devicePrivateKeyPem);
const protectedRuntimeFile = {
  schemaVersion: 1,
  productId: runtimeBinding.productId,
  suiteId: runtimeBinding.suiteId,
  keyId: runtimeBinding.keyId,
  installationId: runtimeBinding.installationId,
  dataRootId: runtimeBinding.dataRootId,
  ...signedRuntime,
  protectedPayload: 'test-only-protected-payload'
};
assert.deepEqual(verifySignedRuntimeBinding(protectedRuntimeFile), runtimeBinding);
const tamperedRuntimeSignature = `${protectedRuntimeFile.signature[0] === 'A' ? 'B' : 'A'}${protectedRuntimeFile.signature.slice(1)}`;
assert.throws(() => verifySignedRuntimeBinding({
  ...protectedRuntimeFile,
  signature: tamperedRuntimeSignature
}), /signature/i);

const instance = createSignalInstanceBinding(runtimeBinding, 'profile-a', devicePrivateKeyPem);
assert.equal(verifySignalInstanceBinding(instance, runtimeBinding, 'profile-a'), true);
assert.equal(verifySignalInstanceBinding(instance, runtimeBinding, 'profile-b'), false);
assert.equal(verifySignalInstanceBinding({ ...instance, dataRootId: 'tampered' }, runtimeBinding, 'profile-a'), false);

const issuedAt = 1_800_000_000_000;
const credential = createSignalLaunchCredential(runtimeBinding, 'profile-a', 43210, devicePrivateKeyPem, issuedAt);
const expectation = {
  suiteId: runtimeBinding.suiteId,
  installationId: runtimeBinding.installationId,
  dataRootId: runtimeBinding.dataRootId,
  profileId: 'profile-a',
  processId: 43210
};
assert.equal(credential.expiresAt - credential.issuedAt, signalLaunchCredentialTtlMs);
assert.equal(Buffer.from(credential.nonce, 'base64url').length, 32);
assert.equal(Buffer.from(credential.controlKey, 'base64url').length, 32);
assert.equal(verifySignalLaunchCredential(credential, runtimeBinding, expectation, issuedAt + 9_999), true);
assert.equal(verifySignalLaunchCredential(credential, runtimeBinding, expectation, issuedAt + 10_001), false);
assert.equal(verifySignalLaunchCredential(credential, runtimeBinding, { ...expectation, processId: 43211 }, issuedAt), false);
assert.equal(verifySignalLaunchCredential({ ...credential, nonce: Buffer.alloc(32, 8).toString('base64url') }, runtimeBinding, expectation, issuedAt), false);
assert.equal(verifySignalLaunchCredential({ ...credential, controlKey: Buffer.alloc(32, 8).toString('base64url') }, runtimeBinding, expectation, issuedAt), false);
assert.equal(signalGuard.verifyInstanceBinding(instance, runtimeBinding, 'profile-a'), true);
assert.equal(signalGuard.verifyInstanceBinding(instance, runtimeBinding, 'profile-b'), false);
assert.equal(signalGuard.verifyLaunchCredential(credential, runtimeBinding, expectation, issuedAt + 9_999), true);
assert.equal(signalGuard.verifyLaunchCredential(credential, runtimeBinding, expectation, issuedAt + 10_001), false);
assert.equal(signalGuard.deriveDataRoot(join('C:\\', 'maoyi Data', 'SignalInstances', 'Signal-profile-a')), 'C:\\maoyi Data');

const pipePayload = JSON.stringify({ credential: 'named-pipe-only' });
const pipeAddress = `\\\\.\\pipe\\maoyi-signal-test-${process.pid}-${Date.now()}`;
const pipeServer = createServer(socket => socket.end(pipePayload));
await new Promise((resolvePromise, reject) => {
  pipeServer.once('error', reject);
  pipeServer.listen(pipeAddress, resolvePromise);
});
const pipeResult = await new Promise((resolvePromise, reject) => {
  const clientScript = "const fs=require('node:fs');process.stdout.write(fs.readFileSync(process.argv[1],'utf8'))";
  const child = spawn(process.execPath, ['-e', clientScript, pipeAddress], { stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { output += chunk; });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolvePromise(output) : reject(new Error(`Pipe child exited ${code}`)));
});
await new Promise(resolvePromise => pipeServer.close(resolvePromise));
assert.equal(pipeResult, pipePayload);

const testBase = resolve('.tmp', 'runtime-security-test');
const dataRoot = join(testBase, 'maoyi Data');
const bootstrapPath = join(testBase, 'launcher', 'storage.json');
await rm(testBase, { recursive: true, force: true });
await assert.rejects(
  createCloneResetPlan({ targetRoot: join(testBase, 'unsafe-root'), parentProcessId: 0 }),
  /application-owned data root/
);
await mkdir(join(dataRoot, 'SignalInstances', 'Signal-profile-a'), { recursive: true });
await mkdir(join(dataRoot, 'Partitions', 'chat-profile-a'), { recursive: true });
await mkdir(join(dataRoot, 'TranslationCache'), { recursive: true });
await mkdir(join(testBase, 'launcher'), { recursive: true });
await writeFile(join(dataRoot, 'SignalInstances', 'Signal-profile-a', 'db.sqlite'), 'copied-signal-data');
await writeFile(join(dataRoot, 'Partitions', 'chat-profile-a', 'Cookies'), 'copied-web-data');
await writeFile(join(dataRoot, 'TranslationCache', 'chunk.json'), 'copied-cache');
await writeFile(join(dataRoot, 'runtime-binding.dat'), JSON.stringify({
  schemaVersion: 1,
  productId: 'maoyi',
  suiteId: runtimeBinding.suiteId,
  keyId: runtimeBinding.keyId,
  installationId: runtimeBinding.installationId,
  dataRootId: runtimeBinding.dataRootId,
  signedPayload: 'signed-test-payload',
  signature: 'signed-test-signature',
  protectedPayload: 'foreign-dpapi-payload'
}));
await writeFile(bootstrapPath, JSON.stringify({ dataPath: dataRoot }));

const { planPath } = await createCloneResetPlan({
  targetRoot: dataRoot,
  bootstrapPath,
  expectedDataRootId: runtimeBinding.dataRootId,
  expectedSuiteId: runtimeBinding.suiteId,
  parentProcessId: 0
});
const resetResult = await runCloneResetWorker(planPath);
assert.equal(resetResult.removedRoot, true);
await assert.rejects(readFile(dataRoot), /ENOENT/);
await assert.rejects(readFile(bootstrapPath), /ENOENT/);

await rm(testBase, { recursive: true, force: true });
console.log('runtime-security: credential and full-reset checks passed');
