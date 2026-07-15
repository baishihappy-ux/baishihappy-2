const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const asar = require('@electron/asar');
const { FuseState, FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function findFile(root, fileName) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name === fileName) return target;
    }
  }
  throw new Error(`${fileName} was not found under ${root}`);
}

function collectPaths(root) {
  const paths = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      paths.push(target);
      if (entry.isSymbolicLink()) throw new Error(`Packaged output contains a symbolic link: ${target}`);
      if (entry.isDirectory()) pending.push(target);
    }
  }
  return paths;
}

function hasSensitiveKey(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:deepseekApiKey|serviceSecret|privateKeyPem|protectedPrivateKey)$/i.test(key)) return true;
    if (hasSensitiveKey(child)) return true;
  }
  return false;
}

function verifyNoForbiddenResources(resources) {
  const forbiddenPatterns = [
    /(?:^|[\\/])trial-config\.json$/i,
    /(?:^|[\\/])license-suite\.sealed$/i,
    /(?:^|[\\/])issuer-suite-key\.json$/i,
    /(?:^|[\\/])current-license-suite\.json$/i,
    /(?:^|[\\/])client-license-suite\.json$/i,
    /(?:^|[\\/])\.package-secrets(?:[\\/]|$)/i,
    /(?:^|[\\/])df-runtime-binding\.dat$/i,
    /(?:^|[\\/])app\.(?:original|patched|before[^\\/]*)\.asar(?:\.unpacked)?(?:[\\/]|$)/i
  ];
  const paths = collectPaths(resources);
  for (const target of paths) {
    const relative = path.relative(resources, target);
    const forbidden = forbiddenPatterns.find((pattern) => pattern.test(relative));
    if (forbidden) throw new Error(`Client package contains forbidden resource: ${relative}`);
  }

  for (const target of paths) {
    if (!target.toLowerCase().endsWith('.json')) continue;
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;
    try {
      const value = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (hasSensitiveKey(value)) {
        throw new Error(`Client package JSON contains a secret-bearing field: ${path.relative(resources, target)}`);
      }
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
}

function verifyPublicLicenseSuite(resources) {
  const suitePath = path.join(resources, 'license-suite-public.json');
  const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
  const expectedKeys = ['issuerId', 'keyId', 'productId', 'publicKeyPem', 'suiteId'];
  const actualKeys = Object.keys(suite).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`Public license suite contains unexpected fields: ${actualKeys.join(', ')}`);
  }
  for (const key of expectedKeys) {
    if (typeof suite[key] !== 'string' || !suite[key]) throw new Error(`Public license suite field is missing: ${key}`);
  }
}

async function verifyMaoyiFuses(executablePath) {
  const wire = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE]
  ]);
  for (const [option, state] of expected) {
    if (wire[option] !== state) throw new Error(`${path.basename(executablePath)} fuse ${FuseV1Options[option]} is not hardened.`);
  }
}

async function verifySignalFuses(executablePath) {
  const wire = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.DISABLE],
    // Signal 8.18 requires this for bundles/preload/wrapper.js. Disabling it
    // passes a process-alive smoke test but leaves every Signal window white.
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.ENABLE]
  ]);
  for (const [option, state] of expected) {
    if (wire[option] !== state) throw new Error(`Signal.exe fuse ${FuseV1Options[option]} is incompatible with the verified runtime profile.`);
  }
}

async function verifyClient(clientRoot) {
  const executable = findFile(clientRoot, 'maoyi.exe');
  await verifyMaoyiFuses(executable);
  const appRoot = path.dirname(executable);
  const resources = path.join(appRoot, 'resources');
  verifyNoForbiddenResources(resources);
  verifyPublicLicenseSuite(resources);
  const appAsar = path.join(resources, 'app.asar');
  const entries = await asar.listPackage(appAsar);
  for (const forbidden of [/license-issuer/i, /trial-config/i, /issuer-suite-key/i, /license-suite\.sealed/i]) {
    if (entries.some((entry) => forbidden.test(entry))) throw new Error(`Client app.asar contains forbidden entry matching ${forbidden}.`);
  }
  const signalExecutable = path.join(resources, 'signal', 'Signal.exe');
  await verifySignalFuses(signalExecutable);
  const signalAsar = path.join(resources, 'signal', 'resources', 'app.asar');
  const signalMain = Buffer.from(await asar.extractFile(signalAsar, 'bundles/main.js')).toString('utf8');
  const signalEntries = await asar.listPackage(signalAsar);
  const bridgeEntry = signalEntries.find((entry) => /(?:^|[\\/])bundles[\\/]chunks[\\/]messageBridge\.main-[^\\/]+\.js$/.test(entry));
  const signalBridge = bridgeEntry
    ? Buffer.from(await asar.extractFile(signalAsar, bridgeEntry.replace(/^[/\\]/, ''))).toString('utf8')
    : signalMain;
  if (!signalBridge.includes('maoyi-signal-control-auth-v1') && !signalMain.includes('__dfSignalControlAuthV1')) {
    throw new Error('Bundled Signal is missing authenticated control protocol.');
  }
  let launcherGuarded = signalMain.includes('dfLaunchPipe') && signalMain.includes('local-direct-blocked') && signalMain.includes('credential-accepted');
  if (!launcherGuarded && signalEntries.some((entry) => /(?:^|[\\/])df-bootstrap\.cjs$/.test(entry))) {
    const signalGuard = Buffer.from(await asar.extractFile(signalAsar, 'df-bootstrap.cjs')).toString('utf8');
    launcherGuarded = signalGuard.includes('credential.controlKey');
  }
  if (!launcherGuarded) throw new Error('Bundled Signal guard is missing the launcher credential binding.');
  return executable;
}

async function verifyIssuer(issuerRoot, expectedSuiteId) {
  const executable = findFile(issuerRoot, 'MAOYI AUTHORIZER.exe');
  await verifyMaoyiFuses(executable);
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  const entries = await asar.listPackage(appAsar);
  if (entries.some((entry) => /trial-config/i.test(entry))) throw new Error('Issuer app.asar contains trial-config data.');
  const identity = JSON.parse(asar.extractFile(appAsar, 'dist-electron/issuer-suite-key.json').toString('utf8'));
  if (
    !/^\d{9}$/.test(identity.suiteId || '') ||
    identity.suiteId !== expectedSuiteId ||
    !identity.keyId ||
    !/^[a-f0-9]{64}$/i.test(identity.publicKeySha256 || '')
  ) throw new Error('Issuer app.asar is missing the expected suite-scoped identity.');
  return executable;
}

async function verifyPromptGenerator(promptGeneratorRoot) {
  const executable = findFile(promptGeneratorRoot, '\u9f0e\u4e30\u63d0\u793a\u8bcd\u6587\u4ef6\u751f\u6210\u5668.exe');
  await verifyMaoyiFuses(executable);
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  const entries = await asar.listPackage(appAsar);
  for (const forbidden of [/client-license-suite/i, /current-license-suite/i, /license-suite\.sealed/i, /issuer-suite-key/i, /privateKeyPem/i]) {
    if (entries.some((entry) => forbidden.test(entry))) {
      throw new Error(`Prompt generator app.asar contains forbidden entry matching ${forbidden}.`);
    }
  }
  return executable;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyExecutableStarts(executable, label, userDataEnvironmentName = '') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'maoyi-package-smoke-'));
  let child;
  try {
    // Match a normal desktop launch. Do not add diagnostic switches that users
    // will not have when opening the packaged executable.
    child = spawn(executable, [`--user-data-dir=${userData}`], {
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        ...(userDataEnvironmentName ? { [userDataEnvironmentName]: userData } : {})
      }
    });
    const launchError = new Promise((_, reject) => child.once('error', reject));
    await Promise.race([delay(6_000), launchError]);
    if (child.exitCode !== null) {
      throw new Error(`${label} exited during the packaged startup smoke test with code ${child.exitCode}.`);
    }
  } finally {
    if (child?.pid) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } catch {
        child.kill();
      }
    }
    await delay(750);
    try {
      fs.rmSync(userData, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 });
    } catch (error) {
      // A successful startup must not be reported as failed only because Windows
      // is still releasing a Chromium profile file. The directory is temporary.
      console.warn(`packaged-output: could not remove smoke directory ${userData}: ${error.code || error}`);
    }
  }
}

async function main() {
  if (!argument('client')) throw new Error('--client is required.');
  const expectedSuiteId = argument('suite-id');
  if (argument('issuer') && !/^\d{9}$/.test(expectedSuiteId)) {
    throw new Error('--suite-id is required and must contain nine digits when verifying an issuer.');
  }
  const clientRoot = path.resolve(argument('client'));
  const clientExecutable = await verifyClient(clientRoot);
  const issuerExecutable = argument('issuer')
    ? await verifyIssuer(path.resolve(argument('issuer')), expectedSuiteId)
    : '';
  const promptGeneratorExecutable = argument('prompt-generator')
    ? await verifyPromptGenerator(path.resolve(argument('prompt-generator')))
    : '';
  await verifyExecutableStarts(clientExecutable, 'Client', 'MAOYI_USER_DATA_DIR');
  if (issuerExecutable) {
    await delay(1_500);
    await verifyExecutableStarts(issuerExecutable, 'Issuer', 'MAOYI_ISSUER_USER_DATA_DIR');
  }
  if (promptGeneratorExecutable) {
    await delay(1_500);
    await verifyExecutableStarts(promptGeneratorExecutable, 'Prompt generator');
  }
  console.log('packaged-output: requested artifacts passed security checks');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
