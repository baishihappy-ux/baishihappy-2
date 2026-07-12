const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const ORIGINAL_MAIN = './bundles/main.js';
const PRODUCT_ID = 'maoyi';
const SCHEMA_VERSION = 1;
const CREDENTIAL_TTL_MS = 10_000;
const CREDENTIAL_MAX_BYTES = 64 * 1024;
const RESET_PLAN_TTL_MS = 5 * 60_000;
const RESET_PARENT_WAIT_MS = 15_000;
const RESET_ARGUMENT = '--df-clone-reset-plan=';
const RESET_MARKER_NAME = '.df-clone-reset-marker.json';
const RUNTIME_BINDING_NAME = 'runtime-binding.dat';
const RUNTIME_SIDECAR_NAME = 'df-runtime-binding.dat';
const INSTANCE_BINDING_NAME = 'df-instance-binding.dat';
const DATA_ROOT_NAMES = new Set(['maoyi data', 'maoyi']);

function diagnostic(stage, details = {}) {
  const diagnosticPath = process.env.MAOYI_SIGNAL_GUARD_DIAGNOSTIC;
  if (!diagnosticPath) return;
  try {
    fs.writeFileSync(diagnosticPath, `${JSON.stringify({ stage, at: Date.now(), ...details })}\n`, 'utf8');
  } catch {
    // Development diagnostics must never affect the guard decision.
  }
}

function argValue(name, args = process.argv) {
  const item = args.find(value => value === name || value.startsWith(`${name}=`));
  if (!item) return '';
  return item === name ? '1' : item.slice(name.length + 1);
}

function samePath(left, right) {
  return path.normalize(path.resolve(left)).toLowerCase() === path.normalize(path.resolve(right)).toLowerCase();
}

function isOwnedDataRoot(value) {
  if (!value || !path.isAbsolute(value) || value.startsWith('\\\\')) return false;
  const resolved = path.resolve(value);
  return !samePath(resolved, path.parse(resolved).root) && DATA_ROOT_NAMES.has(path.basename(resolved).toLowerCase());
}

function deriveDataRoot(dataDir) {
  if (!dataDir || !path.isAbsolute(dataDir)) return '';
  const instanceDir = path.resolve(dataDir);
  const instancesRoot = path.dirname(instanceDir);
  if (path.basename(instancesRoot).toLowerCase() !== 'signalinstances') return '';
  const dataRoot = path.dirname(instancesRoot);
  return isOwnedDataRoot(dataRoot) ? dataRoot : '';
}

function verifyValues(publicKeyPem, signature, values) {
  try {
    return crypto.verify(
      null,
      Buffer.from(JSON.stringify(values)),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url')
    );
  } catch {
    return false;
  }
}

function currentHardwareHash() {
  let stableGuid = '';
  try {
    const output = execFileSync('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid'
    ], { windowsHide: true, encoding: 'utf8' });
    stableGuid = output.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i)?.[1]?.trim() || '';
  } catch {
    stableGuid = '';
  }
  const fallback = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || 'unknown-cpu'].join('\0');
  return crypto.createHash('sha256').update(stableGuid || fallback).digest('hex');
}

function validateRuntimePayload(payload) {
  if (
    !payload ||
    payload.schemaVersion !== SCHEMA_VERSION ||
    payload.productId !== PRODUCT_ID ||
    !payload.suiteId ||
    !payload.keyId ||
    !payload.installationId ||
    !payload.dataRootId ||
    !/^[a-f0-9]{64}$/i.test(payload.machineCodeHash || '') ||
    !/^[a-f0-9]{64}$/i.test(payload.hardwareHash || '') ||
    !payload.devicePublicKeyPem
  ) {
    throw new Error('Invalid runtime binding payload.');
  }
  crypto.createPublicKey(payload.devicePublicKeyPem);
  return payload;
}

function runtimeBindingSignatureValues(payload) {
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

function inspectBindingFile(bindingPath) {
  let file;
  try {
    file = JSON.parse(fs.readFileSync(bindingPath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return { state: 'missing' };
    return { state: 'foreign', reason: 'binding-read-failed' };
  }
  try {
    if (
      file.schemaVersion !== SCHEMA_VERSION ||
      file.productId !== PRODUCT_ID ||
      !file.signedPayload ||
      !file.signature
    ) {
      return { state: 'foreign', file, reason: 'binding-invalid' };
    }
    const payload = validateRuntimePayload(JSON.parse(
      Buffer.from(file.signedPayload, 'base64url').toString('utf8')
    ));
    if (
      payload.suiteId !== file.suiteId ||
      payload.keyId !== file.keyId ||
      payload.installationId !== file.installationId ||
      payload.dataRootId !== file.dataRootId ||
      !verifyValues(payload.devicePublicKeyPem, file.signature, runtimeBindingSignatureValues(payload))
    ) {
      return { state: 'foreign', file, reason: 'binding-metadata-mismatch' };
    }
    if (payload.hardwareHash !== currentHardwareHash()) {
      return { state: 'foreign', file, reason: 'binding-hardware-mismatch' };
    }
    return { state: 'local', file, payload };
  } catch {
    return { state: 'foreign', file, reason: 'binding-signature-failed' };
  }
}

function instanceSignatureValues(binding) {
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

function verifyInstanceBinding(binding, runtimeBinding, profileId) {
  if (
    !binding ||
    binding.schemaVersion !== SCHEMA_VERSION ||
    binding.productId !== PRODUCT_ID ||
    binding.suiteId !== runtimeBinding.suiteId ||
    binding.installationId !== runtimeBinding.installationId ||
    binding.dataRootId !== runtimeBinding.dataRootId ||
    binding.profileId !== profileId ||
    !Number.isFinite(Date.parse(binding.createdAt))
  ) return false;
  const unsigned = { ...binding };
  delete unsigned.signature;
  return verifyValues(
    runtimeBinding.devicePublicKeyPem,
    binding.signature,
    instanceSignatureValues(unsigned)
  );
}

function launchSignatureValues(credential) {
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

function verifyLaunchCredential(credential, runtimeBinding, expectation, now = Date.now()) {
  if (
    !credential ||
    credential.schemaVersion !== SCHEMA_VERSION ||
    credential.productId !== PRODUCT_ID ||
    credential.suiteId !== expectation.suiteId ||
    credential.installationId !== expectation.installationId ||
    credential.dataRootId !== expectation.dataRootId ||
    credential.profileId !== expectation.profileId ||
    credential.processId !== expectation.processId ||
    !Number.isInteger(credential.issuedAt) ||
    !Number.isInteger(credential.expiresAt) ||
    credential.expiresAt - credential.issuedAt !== CREDENTIAL_TTL_MS ||
    now < credential.issuedAt - 1_000 ||
    now > credential.expiresAt ||
    Buffer.from(credential.nonce || '', 'base64url').length !== 32 ||
    Buffer.from(credential.controlKey || '', 'base64url').length !== 32
  ) return false;
  const unsigned = { ...credential };
  delete unsigned.signature;
  return verifyValues(
    runtimeBinding.devicePublicKeyPem,
    credential.signature,
    launchSignatureValues(unsigned)
  );
}

function readCredentialPipe(address) {
  if (!address || !address.startsWith('\\\\.\\pipe\\maoyi-signal-')) {
    throw new Error('credential-pipe-address-invalid');
  }
  const text = fs.readFileSync(address, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > CREDENTIAL_MAX_BYTES) throw new Error('credential-too-large');
  return JSON.parse(text.trim());
}

function bootstrapPath(app) {
  return path.join(app.getPath('appData'), 'maoyi Launcher', 'storage.json');
}

function rootFromBootstrap(app) {
  try {
    const parsed = JSON.parse(fs.readFileSync(bootstrapPath(app), 'utf8'));
    return typeof parsed.dataPath === 'string' && isOwnedDataRoot(parsed.dataPath)
      ? path.resolve(parsed.dataPath)
      : '';
  } catch {
    return '';
  }
}

async function writeAtomic(targetPath, value) {
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(temporaryPath, value, 'utf8');
  try {
    await fsp.rename(temporaryPath, targetPath);
  } catch (error) {
    await fsp.rm(targetPath, { force: true });
    await fsp.rename(temporaryPath, targetPath);
    void error;
  }
}

function resetWorkRoot() {
  return path.join(os.tmpdir(), 'maoyi-Reset');
}

async function createResetPlan({ targetRoot, bootstrapFile, runtimeBindingPaths, bindingFile }) {
  const now = Date.now();
  const resetId = crypto.randomUUID();
  const resolvedRoot = targetRoot && isOwnedDataRoot(targetRoot) ? path.resolve(targetRoot) : undefined;
  if (resolvedRoot) {
    await writeAtomic(path.join(resolvedRoot, RESET_MARKER_NAME), `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      productId: PRODUCT_ID,
      resetId,
      createdAt: now
    })}\n`);
  }
  const plan = {
    schemaVersion: SCHEMA_VERSION,
    productId: PRODUCT_ID,
    resetId,
    targetRoot: resolvedRoot,
    bootstrapPath: bootstrapFile,
    runtimeBindingPaths: [...new Set((runtimeBindingPaths || []).map(value => path.resolve(value)))],
    expectedDataRootId: bindingFile && bindingFile.dataRootId,
    expectedSuiteId: bindingFile && bindingFile.suiteId,
    parentProcessId: process.pid,
    createdAt: now,
    expiresAt: now + RESET_PLAN_TTL_MS
  };
  const planPath = path.join(resetWorkRoot(), `reset-${resetId}.json`);
  await writeAtomic(planPath, `${JSON.stringify(plan)}\n`);
  return planPath;
}

async function processExists(processId) {
  if (!Number.isInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForParentExit(processId) {
  const deadline = Date.now() + RESET_PARENT_WAIT_MS;
  while (Date.now() < deadline && await processExists(processId)) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  if (await processExists(processId)) throw new Error('reset-parent-still-running');
}

async function retryDelete(operation) {
  const delays = [0, 250, 500, 1_000, 2_000, 4_000, 8_000];
  let lastError;
  for (const delay of delays) {
    if (delay) await new Promise(resolvePromise => setTimeout(resolvePromise, delay));
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function removeTreeWithoutFollowingLinks(targetPath) {
  let entries;
  try {
    entries = await fsp.readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isSymbolicLink()) {
      await retryDelete(() => fsp.unlink(entryPath).catch(() => fsp.rm(entryPath, { force: true })));
    } else if (entry.isDirectory()) {
      await removeTreeWithoutFollowingLinks(entryPath);
    } else {
      await retryDelete(() => fsp.rm(entryPath, { force: true }));
    }
  }
  await retryDelete(() => fsp.rmdir(targetPath));
}

async function validateResetTarget(plan) {
  if (!plan.targetRoot) return;
  if (!isOwnedDataRoot(plan.targetRoot)) throw new Error('reset-root-invalid');
  const rootStat = await fsp.lstat(plan.targetRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('reset-root-not-directory');
  const marker = JSON.parse(await fsp.readFile(path.join(plan.targetRoot, RESET_MARKER_NAME), 'utf8'));
  if (marker.schemaVersion !== SCHEMA_VERSION || marker.productId !== PRODUCT_ID || marker.resetId !== plan.resetId) {
    throw new Error('reset-marker-invalid');
  }
  if (plan.expectedDataRootId || plan.expectedSuiteId) {
    const binding = JSON.parse(await fsp.readFile(path.join(plan.targetRoot, RUNTIME_BINDING_NAME), 'utf8'));
    if (
      binding.productId !== PRODUCT_ID ||
      (plan.expectedDataRootId && binding.dataRootId !== plan.expectedDataRootId) ||
      (plan.expectedSuiteId && binding.suiteId !== plan.expectedSuiteId)
    ) throw new Error('reset-binding-invalid');
  }
}

async function removeBootstrapIfOwned(bootstrapFile, targetRoot) {
  if (!bootstrapFile || !targetRoot) return;
  try {
    const parsed = JSON.parse(await fsp.readFile(bootstrapFile, 'utf8'));
    if (typeof parsed.dataPath !== 'string' || !samePath(parsed.dataPath, targetRoot)) return;
    await fsp.rm(bootstrapFile, { force: true });
    await fsp.rmdir(path.dirname(bootstrapFile)).catch(() => undefined);
  } catch {
    // Missing and unrelated launch pointers are not reset.
  }
}

async function runResetWorker(planPath, ownRuntimeBindingPath) {
  const resolvedPlanPath = path.resolve(planPath);
  if (!samePath(path.dirname(resolvedPlanPath), resetWorkRoot())) throw new Error('reset-plan-path-invalid');
  const plan = JSON.parse(await fsp.readFile(resolvedPlanPath, 'utf8'));
  if (
    plan.schemaVersion !== SCHEMA_VERSION ||
    plan.productId !== PRODUCT_ID ||
    !plan.resetId ||
    Date.now() > plan.expiresAt ||
    plan.expiresAt - plan.createdAt !== RESET_PLAN_TTL_MS
  ) throw new Error('reset-plan-invalid');
  await validateResetTarget(plan);
  await waitForParentExit(plan.parentProcessId);
  if (plan.targetRoot) await removeTreeWithoutFollowingLinks(path.resolve(plan.targetRoot));
  await removeBootstrapIfOwned(plan.bootstrapPath, plan.targetRoot);
  for (const bindingPath of plan.runtimeBindingPaths || []) {
    if (!samePath(bindingPath, ownRuntimeBindingPath)) continue;
    try {
      const binding = JSON.parse(await fsp.readFile(bindingPath, 'utf8'));
      if (binding.productId === PRODUCT_ID && (!plan.expectedDataRootId || binding.dataRootId === plan.expectedDataRootId)) {
        await fsp.rm(bindingPath, { force: true });
      }
    } catch {
      // Missing sidecars are already initialized.
    }
  }
  await fsp.rm(resolvedPlanPath, { force: true });
}

function blockLocalDirectStart(app, dialog) {
  diagnostic('local-direct-blocked');
  if (process.env.MAOYI_SIGNAL_GUARD_TEST_AUTOCLOSE !== '1') {
    dialog.showErrorBox('maoyi', '缺少启动器，请从 maoyi 启动');
  }
  app.exit(0);
}

async function initializeForeignCopy({ app, dialog, bindingFile, dataRoot, runtimeSidecarPath }) {
  diagnostic('foreign-initializing', { dataRootPresent: Boolean(dataRoot) });
  if (process.env.MAOYI_SIGNAL_GUARD_TEST_AUTOCLOSE !== '1') {
    dialog.showErrorBox('maoyi', '缺少启动器，正在初始化');
  }
  const planPath = await createResetPlan({
    targetRoot: dataRoot,
    bootstrapFile: dataRoot ? bootstrapPath(app) : undefined,
    runtimeBindingPaths: [runtimeSidecarPath],
    bindingFile
  });
  const helperDataPath = path.join(resetWorkRoot(), `signal-worker-${crypto.randomBytes(10).toString('hex')}`);
  const child = spawn(process.execPath, [
    `${RESET_ARGUMENT}${planPath}`,
    `--user-data-dir=${helperDataPath}`
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  child.unref();
  app.exit(0);
}

async function startSignalGuard() {
  const { app, dialog } = require('electron');
  const runtimeSidecarPath = path.join(process.resourcesPath, RUNTIME_SIDECAR_NAME);
  const resetPlanPath = argValue('--df-clone-reset-plan');
  if (resetPlanPath) {
    const workerDataPath = argValue('--user-data-dir') || path.join(resetWorkRoot(), `signal-worker-${process.pid}`);
    app.setPath('userData', workerDataPath);
    app.setPath('sessionData', workerDataPath);
    try {
      await runResetWorker(resetPlanPath, runtimeSidecarPath);
      app.exit(0);
    } catch {
      dialog.showErrorBox('maoyi', '初始化未完成，请重新启动程序重试');
      app.exit(1);
    }
    return;
  }
  diagnostic('guard-start', {
    resetWorker: false,
    launcherFlag: argValue('--df') === '1',
    embedMode: argValue('--windowMode') === 'embed',
    launchPipePresent: Boolean(argValue('--dfLaunchPipe')),
    dataDirPresent: Boolean(argValue('--user-data-dir'))
  });

  const dataDir = argValue('--user-data-dir');
  const dataRoot = deriveDataRoot(dataDir);
  const bootstrapRoot = rootFromBootstrap(app);
  const rootBindingPath = dataRoot
    ? path.join(dataRoot, RUNTIME_BINDING_NAME)
    : bootstrapRoot
      ? path.join(bootstrapRoot, RUNTIME_BINDING_NAME)
      : '';
  const bindingPath = rootBindingPath && fs.existsSync(rootBindingPath)
    ? rootBindingPath
    : runtimeSidecarPath;
  const bindingInspection = inspectBindingFile(bindingPath);
  diagnostic('binding-inspected', { state: bindingInspection.state, source: bindingPath === runtimeSidecarPath ? 'runtime' : 'data-root' });
  const launcherMode = argValue('--df') === '1' && argValue('--windowMode') === 'embed';

  if (bindingInspection.state === 'missing' && (dataRoot || bootstrapRoot)) {
    diagnostic('binding-missing-data-preserved');
    blockLocalDirectStart(app, dialog);
    return;
  }
  if (bindingInspection.state !== 'local') {
    await initializeForeignCopy({
      app,
      dialog,
      bindingFile: bindingInspection.file,
      dataRoot: dataRoot || (rootBindingPath ? bootstrapRoot : ''),
      runtimeSidecarPath
    });
    return;
  }
  if (!launcherMode) {
    blockLocalDirectStart(app, dialog);
    return;
  }

  const profileId = argValue('--appId').replace(/^Signal-/, '');
  if (!dataRoot || !profileId) {
    blockLocalDirectStart(app, dialog);
    return;
  }
  let instanceBinding;
  try {
    instanceBinding = JSON.parse(fs.readFileSync(path.join(dataDir, INSTANCE_BINDING_NAME), 'utf8'));
  } catch {
    blockLocalDirectStart(app, dialog);
    return;
  }
  if (!verifyInstanceBinding(instanceBinding, bindingInspection.payload, profileId)) {
    blockLocalDirectStart(app, dialog);
    return;
  }
  let credential;
  try {
    diagnostic('credential-connecting', { launchPipePresent: Boolean(argValue('--dfLaunchPipe')) });
    credential = readCredentialPipe(argValue('--dfLaunchPipe'));
    diagnostic('credential-received');
  } catch (error) {
    diagnostic('credential-failed', { error: error instanceof Error ? error.message : String(error) });
    blockLocalDirectStart(app, dialog);
    return;
  }
  const expectation = {
    suiteId: bindingInspection.payload.suiteId,
    installationId: bindingInspection.payload.installationId,
    dataRootId: bindingInspection.payload.dataRootId,
    profileId,
    processId: process.pid
  };
  if (!verifyLaunchCredential(credential, bindingInspection.payload, expectation)) {
    diagnostic('credential-rejected');
    blockLocalDirectStart(app, dialog);
    return;
  }
  process.env.MAOYI_SIGNAL_CONTROL_KEY = credential.controlKey;
  diagnostic('credential-accepted');
  require(ORIGINAL_MAIN);
}

module.exports = {
  deriveDataRoot,
  isOwnedDataRoot,
  verifyInstanceBinding,
  verifyLaunchCredential
};

if (process.versions.electron) {
  startSignalGuard().catch(() => {
    try {
      const { app, dialog } = require('electron');
      dialog.showErrorBox('maoyi', '内置 Signal 启动校验失败');
      app.exit(1);
    } catch {
      process.exit(1);
    }
  });
}
