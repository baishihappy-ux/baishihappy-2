const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createHash, generateKeyPairSync, randomBytes } = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');
const sourceExperimentRoot = path.join(projectRoot, '.tmp', 'signal-source');
const isolationRoot = path.join(projectRoot, '.tmp', 'signal-source-ui');
const runtimeRoot = path.join(projectRoot, '.runtime');
const probePath = path.join(__dirname, 'windows-window-probe.ps1');
const powershellPath = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);

const overallTimeoutMs = 150_000;
const visibleWindowTimeoutMs = 90_000;
const pollIntervalMs = 350;
const sourceAppWindowClass = 'Chrome_WidgetWin_1';
const defaultBaselineVersion = '8.17.0';
const supportedBaselines = Object.freeze({
  '8.17.0': Object.freeze({
    archiveSha256: '8AC74903BE12CB6F4806CD3B218B1422CC9317560EA9E355DCB3EFAAF1CC9D96',
    patchSetSha256: '6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052'
  }),
  '8.18.0': Object.freeze({
    archiveSha256: 'A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66',
    patchSetSha256: 'BF482ACA5FEB79AFD4B0C418E56DF41BEA3C38F284EF8FBDB64C1BF17F5D2650'
  })
});

function usage() {
  return [
    'Development-only Signal source window acceptance test.',
    '',
    'Required environment variables:',
    '  MAOYI_SIGNAL_SOURCE_EXE       Absolute release/win-unpacked/Signal.exe path',
    '  MAOYI_SIGNAL_SOURCE_SHA256    Expected 64-character SHA-256 for that executable',
    '',
    'Optional version selection:',
    '  --version <8.17.0|8.18.0>       Defaults to 8.17.0',
    '',
    'The test writes only below .tmp/signal-source-ui and never reads or launches .runtime.',
    'It opens real GUI windows. Run it only in an interactive Windows desktop session.',
  ].join('\n');
}

function fail(message) {
  throw new Error(message);
}

function selectBaselineVersion(argv) {
  if (argv.length === 0) return defaultBaselineVersion;
  if (argv.length !== 2 || argv[0] !== '--version') {
    fail('Expected an optional --version <8.17.0|8.18.0> argument.');
  }
  const version = argv[1];
  if (!Object.hasOwn(supportedBaselines, version)) {
    fail(`Unsupported Signal source baseline version: ${version}`);
  }
  return version;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function pathIsInside(root, target) {
  const relativePath = path.relative(root, target);
  return Boolean(
    relativePath &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
  );
}

function sameWindowsPath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.once('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.once('end', () => resolve(hash.digest('hex').toUpperCase()));
  });
}

async function validateInputs(baselineVersion) {
  if (process.platform !== 'win32') {
    fail('Signal source window acceptance is Windows-only.');
  }
  if (!fs.existsSync(probePath)) {
    fail(`Windows probe is missing: ${probePath}`);
  }
  if (!fs.existsSync(powershellPath)) {
    fail(`Windows PowerShell is missing: ${powershellPath}`);
  }
  for (const requiredPath of [
    path.join(projectRoot, 'dist-electron', 'main.js'),
    path.join(projectRoot, 'dist', 'index.html'),
  ]) {
    if (!fs.existsSync(requiredPath)) {
      fail(`Built translator output is missing: ${requiredPath}. Run npm run build first.`);
    }
  }

  const sourceValue = process.env.MAOYI_SIGNAL_SOURCE_EXE?.trim() || '';
  if (!sourceValue || !path.isAbsolute(sourceValue)) {
    fail('MAOYI_SIGNAL_SOURCE_EXE must be an absolute path.');
  }
  const expectedSha256 = process.env.MAOYI_SIGNAL_SOURCE_SHA256?.trim().toUpperCase() || '';
  if (!/^[0-9A-F]{64}$/.test(expectedSha256)) {
    fail('MAOYI_SIGNAL_SOURCE_SHA256 must be exactly 64 hexadecimal characters.');
  }

  const experimentRootStat = await fsp.lstat(sourceExperimentRoot);
  if (experimentRootStat.isSymbolicLink() || !experimentRootStat.isDirectory()) {
    fail('The .tmp/signal-source root must be a real directory.');
  }
  const canonicalExperimentRoot = await fsp.realpath(sourceExperimentRoot);
  const canonicalExecutable = await fsp.realpath(sourceValue);
  const executableStat = await fsp.lstat(sourceValue);
  if (executableStat.isSymbolicLink() || !(await fsp.stat(canonicalExecutable)).isFile()) {
    fail('Signal source executable must be a real file, not a symbolic link.');
  }
  if (!pathIsInside(canonicalExperimentRoot, canonicalExecutable)) {
    fail('Signal source executable must stay inside .tmp/signal-source.');
  }
  if (pathIsInside(path.resolve(runtimeRoot), canonicalExecutable)) {
    fail('The source acceptance test refuses every executable below .runtime.');
  }
  if (path.basename(canonicalExecutable).toLowerCase() !== 'signal.exe') {
    fail('Signal source executable must be named Signal.exe.');
  }
  const unpackedRoot = path.dirname(canonicalExecutable);
  const releaseRoot = path.dirname(unpackedRoot);
  if (
    path.basename(unpackedRoot).toLowerCase() !== 'win-unpacked' ||
    path.basename(releaseRoot).toLowerCase() !== 'release'
  ) {
    fail('Signal source executable must come from release/win-unpacked.');
  }
  const resourcesPath = path.join(unpackedRoot, 'resources');
  const resourcesStat = await fsp.lstat(resourcesPath);
  if (resourcesStat.isSymbolicLink() || !resourcesStat.isDirectory()) {
    fail('Signal source resources directory is missing.');
  }

  const preparedRoot = path.dirname(path.dirname(releaseRoot));
  const expectedPreparedRoot = path.join(canonicalExperimentRoot, `v${baselineVersion}`);
  const expectedExecutable = path.join(
    expectedPreparedRoot,
    `Signal-Desktop-${baselineVersion}`,
    'release',
    'win-unpacked',
    'Signal.exe'
  );
  if (
    !sameWindowsPath(preparedRoot, expectedPreparedRoot) ||
    !sameWindowsPath(canonicalExecutable, expectedExecutable)
  ) {
    fail(`Signal source executable is not the exact prepared v${baselineVersion} artifact.`);
  }
  const markerPath = path.join(preparedRoot, '.df-source-experiment.json');
  const markerStat = await fsp.lstat(markerPath);
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    fail('Signal source experiment marker must be a real file.');
  }
  const marker = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  const baseline = supportedBaselines[baselineVersion];
  if (
    marker.schemaVersion !== 1 ||
    marker.version !== baselineVersion ||
    path.basename(preparedRoot) !== `v${marker.version}` ||
    path.basename(path.dirname(releaseRoot)) !== `Signal-Desktop-${marker.version}` ||
    marker.archiveSha256 !== baseline.archiveSha256 ||
    typeof marker.patchSetSha256 !== 'string' ||
    marker.patchSetSha256.toUpperCase() !== baseline.patchSetSha256
  ) {
    fail('Signal source experiment marker does not match the release layout.');
  }

  const actualSha256 = await sha256File(canonicalExecutable);
  if (actualSha256 !== expectedSha256) {
    fail(`Signal.exe SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}.`);
  }
  return {
    executable: canonicalExecutable,
    expectedSha256,
    version: marker.version,
    patchSetSha256: marker.patchSetSha256.toUpperCase(),
  };
}

async function createIsolatedTestData(source) {
  await fsp.mkdir(isolationRoot, { recursive: true });
  const canonicalIsolationRoot = await fsp.realpath(isolationRoot);
  const rootStat = await fsp.lstat(isolationRoot);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('The .tmp/signal-source-ui root must be a real directory.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const testRoot = path.join(canonicalIsolationRoot, `${stamp}-${randomBytes(4).toString('hex')}`);
  const userData = path.join(testRoot, 'maoyi Data');
  const artifacts = path.join(testRoot, 'artifacts');
  await fsp.mkdir(userData, { recursive: true });
  await fsp.mkdir(artifacts, { recursive: true });
  const canonicalUserData = await fsp.realpath(userData);
  if (!pathIsInside(canonicalIsolationRoot, canonicalUserData)) {
    fail('Isolated user data escaped .tmp/signal-source-ui.');
  }

  const runtimeUnpackedRoot = path.join(testRoot, 'release', 'win-unpacked');
  await fsp.cp(path.dirname(source.executable), runtimeUnpackedRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: sourcePath => path.basename(sourcePath).toLowerCase() !== 'df-runtime-binding.dat',
  });
  const runtimeExecutable = await fsp.realpath(path.join(runtimeUnpackedRoot, 'Signal.exe'));
  const runtimeSha256 = await sha256File(runtimeExecutable);
  if (runtimeSha256 !== source.expectedSha256) {
    fail('The isolated Signal runtime copy does not match the verified source executable.');
  }
  await fsp.writeFile(
    path.join(testRoot, '.df-signal-source-runtime-copy.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      version: source.version,
      patchSetSha256: source.patchSetSha256,
      sourceExecutable: source.executable,
      sourceExecutableSha256: source.expectedSha256,
      executableRelativePath: 'release/win-unpacked/Signal.exe',
      createdAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8'
  );

  // 000000000 is the existing smoke-test sentinel. This does not call any suite
  // creation/packaging workflow and therefore does not consume a delivery ID.
  const { publicKey } = generateKeyPairSync('ed25519');
  const publicSuitePath = path.join(testRoot, 'acceptance-public-suite.json');
  await fsp.writeFile(
    publicSuitePath,
    JSON.stringify(
      {
        suiteId: '000000000',
        issuerId: 'maoyi-offline-issuer',
        productId: 'maoyi',
        keyId: 'signal-source-window-ui-acceptance',
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    testRoot,
    userData: canonicalUserData,
    artifacts,
    publicSuitePath,
    visibleCapture: path.join(artifacts, 'signal-visible.png'),
    lockedCapture: path.join(artifacts, 'signal-gate-locked.png'),
    reportPath: path.join(artifacts, 'report.json'),
    source: {
      ...source,
      originalExecutable: source.executable,
      executable: runtimeExecutable,
    },
  };
}

function getFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => {
        if (error) reject(error);
        else if (!port) reject(new Error('Unable to allocate a CDP loopback port.'));
        else resolve(port);
      });
    });
  });
}

function launchTranslator(testData, cdpPort) {
  const electronExecutable = require('electron');
  const childEnvironment = {
    ...process.env,
    MAOYI_USER_DATA_DIR: testData.userData,
    MAOYI_LICENSE_PUBLIC_SUITE_PATH: testData.publicSuitePath,
    MAOYI_SIGNAL_SOURCE_EXE: testData.source.executable,
    MAOYI_SIGNAL_SOURCE_SHA256: testData.source.expectedSha256,
    MAOYI_REQUIRE_LICENSE_IN_DEV: '0',
  };
  for (const name of [
    'MAOYI_ALLOW_CLONE_RESET_FOR_OVERRIDE',
    'MAOYI_CLONE_RESET_TEST_AUTOCONFIRM',
    'MAOYI_SMOKE_CAPTURE_PATH',
    'MAOYI_SMOKE_ENTER_RUNTIME',
    'MAOYI_SMOKE_TEST_EXIT',
    'MAOYI_SMOKE_WRITE_CACHE',
    'ELECTRON_RUN_AS_NODE',
    'VITE_DEV_SERVER_URL',
  ]) {
    delete childEnvironment[name];
  }

  const child = spawn(
    electronExecutable,
    [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${cdpPort}`,
      projectRoot,
    ],
    {
      cwd: projectRoot,
      env: childEnvironment,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  const appendOutput = chunk => {
    output = `${output}${chunk}`.slice(-64 * 1024);
  };
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', appendOutput);
  child.stderr?.on('data', appendOutput);
  return { child, output: () => output };
}

async function waitFor(action, label, timeoutMs, intervalMs = pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await action();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const suffix = lastError ? ` Last error: ${lastError.message || lastError}` : '';
  throw new Error(`Timed out waiting for ${label}.${suffix}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      const read = typeof event.data === 'string'
        ? Promise.resolve(event.data)
        : event.data && typeof event.data.text === 'function'
          ? event.data.text()
          : Promise.resolve(Buffer.from(event.data).toString('utf8'));
      void read.then(text => this.onMessage(text)).catch(() => undefined);
    });
    socket.addEventListener('close', () => this.rejectPending(new Error('CDP connection closed.')));
    socket.addEventListener('error', () => this.rejectPending(new Error('CDP connection failed.')));
  }

  static connect(url) {
    if (typeof WebSocket !== 'function') {
      fail('This test requires the Node.js global WebSocket implementation.');
    }
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('CDP WebSocket connection timed out.'));
      }, 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(new CdpClient(socket));
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Unable to open the CDP WebSocket.'));
      }, { once: true });
    });
  }

  onMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed.'));
    else pending.resolve(message.result || {});
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  call(method, params = {}, timeoutMs = 15_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 15_000) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(detail || 'Renderer evaluation failed.');
    }
    return result.result?.value;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // The Electron process may already have closed the debugging socket.
    }
  }
}

async function connectToTranslator(cdpPort, processState) {
  const target = await waitFor(async () => {
    if (processState.child.exitCode !== null) {
      throw new Error(`Translator exited ${processState.child.exitCode}. ${processState.output()}`);
    }
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find(item =>
      item.type === 'page' &&
      typeof item.webSocketDebuggerUrl === 'string' &&
      (item.url?.startsWith('app://bundle/') || item.title?.includes('MAOYI'))
    );
  }, 'the translator CDP page', 30_000);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');
  return cdp;
}

const rendererVisibilitySource = `
  const isActuallyVisible = element => {
    if (!(element instanceof Element) || element.hidden || element.getClientRects().length === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let current = element; current instanceof Element; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
    }
    return true;
  };
`;

async function collectRendererAcceptanceState(cdp) {
  return cdp.evaluate(`(() => {
    ${rendererVisibilitySource}
    const entryButton = document.querySelector('button.trial-entry-button');
    const appPage = document.querySelector('.app-page');
    const appCenter = document.querySelector('.app-center');
    const workspace = document.querySelector('.workspace-page');
    const host = document.querySelector('.runtime-web-main');
    const signalCards = Array.from(document.querySelectorAll('button.launch-card'))
      .filter(candidate => candidate.querySelector('img[alt="Signal"]'));
    const signalCard = signalCards[0] || null;
    const activeSignalTab = document.querySelector('button.runtime-tab.active img[alt="SG"]');
    return {
      documentReadyState: document.readyState,
      loginVisible: isActuallyVisible(document.querySelector('.login-page')),
      entryVisible: isActuallyVisible(entryButton),
      entryDisabled: entryButton instanceof HTMLButtonElement ? entryButton.disabled : null,
      appPageVisible: isActuallyVisible(appPage),
      appCenterVisible: isActuallyVisible(appCenter),
      signalCardCount: signalCards.length,
      signalCardVisible: isActuallyVisible(signalCard),
      signalCardDisabled: signalCard instanceof HTMLButtonElement ? signalCard.disabled : null,
      workspaceVisible: isActuallyVisible(workspace),
      hostVisible: isActuallyVisible(host),
      signalWorkspace: Boolean(host?.classList.contains('signal-workspace-main')),
      runtimeTabCount: document.querySelectorAll('button.runtime-tab').length,
      activeSignalTabVisible: isActuallyVisible(activeSignalTab),
    };
  })()`);
}

async function rendererAcceptanceError(cdp, phase, error) {
  let rendererState;
  try {
    rendererState = await collectRendererAcceptanceState(cdp);
  } catch (diagnosticError) {
    rendererState = {
      diagnosticError: diagnosticError instanceof Error
        ? diagnosticError.message
        : String(diagnosticError),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `${message} Renderer acceptance state (${phase}): ${JSON.stringify(rendererState)}`
  );
}

async function enterDevelopmentWorkspace(cdp) {
  let phase = 'wait-for-visible-entry-or-application-center';
  try {
    const entryState = await waitFor(
      () => cdp.evaluate(`(() => {
        ${rendererVisibilitySource}
        const page = document.querySelector('.app-page');
        const center = document.querySelector('.app-center');
        if (isActuallyVisible(page) && isActuallyVisible(center)) return 'ready';
        const button = document.querySelector('button.trial-entry-button');
        return isActuallyVisible(button) && !button.disabled ? 'button' : '';
      })()`),
      'a visible development entry or application center',
      30_000
    );
    if (entryState === 'button') {
      phase = 'click-visible-development-entry';
      const clicked = await cdp.evaluate(`(() => {
        ${rendererVisibilitySource}
        const button = document.querySelector('button.trial-entry-button');
        if (!isActuallyVisible(button) || button.disabled) return false;
        button.focus();
        button.click();
        return true;
      })()`);
      if (!clicked) fail('Unable to click the visible development entry button.');
    }
    phase = 'wait-for-visible-application-center';
    await waitFor(
      () => cdp.evaluate(`(() => {
        ${rendererVisibilitySource}
        const page = document.querySelector('.app-page');
        const center = document.querySelector('.app-center');
        return isActuallyVisible(page) && isActuallyVisible(center);
      })()`),
      'the visible application center',
      30_000
    );
  } catch (error) {
    throw await rendererAcceptanceError(cdp, phase, error);
  }
}

async function ensureSignalProfile(cdp) {
  return cdp.evaluate(`(async () => {
    const config = await window.chatTranslator.getConfig();
    const existing = config.profiles.find(profile => profile.platform === 'signal');
    if (existing) return { id: existing.id, created: false };
    const profile = await window.chatTranslator.createProfile(
      'signal',
      'Signal Source UI Acceptance',
      'Isolated Acceptance'
    );
    return { id: profile.id, created: true };
  })()`);
}

async function reloadAndEnter(cdp) {
  await cdp.call('Page.reload', { ignoreCache: true });
  await enterDevelopmentWorkspace(cdp);
}

async function clickSignalApplication(cdp) {
  let phase = 'wait-for-visible-signal-card';
  try {
    await waitFor(
      () => cdp.evaluate(`(() => {
        ${rendererVisibilitySource}
        const page = document.querySelector('.app-page');
        const center = document.querySelector('.app-center');
        const button = Array.from(document.querySelectorAll('button.launch-card'))
          .find(candidate => candidate.querySelector('img[alt="Signal"]'));
        return Boolean(
          isActuallyVisible(page) &&
          isActuallyVisible(center) &&
          isActuallyVisible(button) &&
          !button.disabled
        );
      })()`),
      'the visible enabled Signal application card',
      30_000
    );

    phase = 'click-visible-signal-card';
    const clicked = await cdp.evaluate(`(() => {
      ${rendererVisibilitySource}
      const button = Array.from(document.querySelectorAll('button.launch-card'))
        .find(candidate => candidate.querySelector('img[alt="Signal"]'));
      if (!isActuallyVisible(button) || button.disabled) return false;
      button.focus();
      button.click();
      return true;
    })()`);
    if (!clicked) fail('Unable to click the visible Signal application card.');

    phase = 'wait-for-visible-signal-workspace';
    await waitFor(
      () => cdp.evaluate(`(() => {
        ${rendererVisibilitySource}
        const workspace = document.querySelector('.workspace-page');
        const host = document.querySelector('.runtime-web-main');
        const activeSignalTab = document.querySelector('button.runtime-tab.active img[alt="SG"]');
        return Boolean(
          isActuallyVisible(workspace) &&
          isActuallyVisible(host) &&
          host.classList.contains('signal-workspace-main') &&
          isActuallyVisible(activeSignalTab)
        );
      })()`),
      'the visible active Signal workspace',
      30_000
    );
  } catch (error) {
    throw await rendererAcceptanceError(cdp, phase, error);
  }
}

async function readJson(filePath) {
  return JSON.parse((await fsp.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''));
}

async function waitForSignalControl(testData, profileId) {
  const statusPath = path.join(testData.userData, 'signal-control-status.json');
  const appId = `Signal-${profileId}`;
  return waitFor(async () => {
    const status = await readJson(statusPath);
    const entry = status.entries?.find(item => item.appId === appId && item.connected === true);
    return entry?.processId ? { statusPath, entry } : null;
  }, 'the authenticated Signal control connection', visibleWindowTimeoutMs, 500);
}

async function waitForAcceptedGuard(testData, profileId) {
  const diagnosticPath = path.join(
    testData.userData,
    'SignalInstances',
    `Signal-${profileId}`,
    'df-guard-debug.json'
  );
  const diagnostic = await waitFor(async () => {
    const value = await readJson(diagnosticPath);
    return value.stage === 'credential-accepted' ? value : null;
  }, 'the Signal launch guard credential acceptance', 30_000, 250);
  return { diagnosticPath, diagnostic };
}

function runProbe(action, options) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    probePath,
    '-Action',
    action,
    '-TranslatorProcessId',
    String(options.translatorProcessId),
    '-SignalProcessId',
    String(options.signalProcessId),
  ];
  if (options.handle) args.push('-Handle', String(options.handle));
  if (Number.isInteger(options.x)) args.push('-X', String(options.x));
  if (Number.isInteger(options.y)) args.push('-Y', String(options.y));
  if (options.outputPath) {
    if (!pathIsInside(isolationRoot, path.resolve(options.outputPath))) {
      fail('Probe capture output must stay inside .tmp/signal-source-ui.');
    }
    args.push('-OutputPath', path.resolve(options.outputPath));
  }
  const result = spawnSync(powershellPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Windows probe ${action} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout.trim().replace(/^\uFEFF/, ''));
  parsed.windows = Array.isArray(parsed.windows)
    ? parsed.windows
    : parsed.windows
      ? [parsed.windows]
      : [];
  return parsed;
}

function windowArea(window) {
  return Math.max(0, window.rect?.width || 0) * Math.max(0, window.rect?.height || 0);
}

function applicationWindows(snapshot, processId) {
  return snapshot.windows.filter(window =>
    window.processId === processId &&
    window.className === sourceAppWindowClass &&
    windowArea(window) > 0
  );
}

function primaryWindow(snapshot, processId, visibleOnly = false) {
  return applicationWindows(snapshot, processId)
    .filter(window => !visibleOnly || window.visible)
    .sort((left, right) => windowArea(right) - windowArea(left))[0] || null;
}

function allSignalWindowsHidden(snapshot, signalProcessId) {
  return applicationWindows(snapshot, signalProcessId).every(window => !window.visible);
}

function pidIsAlive(processId) {
  if (!processId) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function writeReport(testData, report) {
  report.finishedAt = new Date().toISOString();
  await fsp.writeFile(testData.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return;
  }

  const baselineVersion = selectBaselineVersion(argv);
  const preparedSource = await validateInputs(baselineVersion);
  const testData = await createIsolatedTestData(preparedSource);
  const source = testData.source;
  const report = {
    schemaVersion: 1,
    test: 'signal-source-window-ui',
    startedAt: new Date().toISOString(),
    result: 'running',
    isolationRoot: testData.testRoot,
    userData: testData.userData,
    source: {
      executable: source.executable,
      originalExecutable: source.originalExecutable,
      sha256: source.expectedSha256,
      version: source.version,
      patchSetSha256: source.patchSetSha256,
    },
    assertions: [],
    artifacts: {
      visibleCapture: testData.visibleCapture,
      lockedCapture: testData.lockedCapture,
    },
  };
  const assert = (name, passed, evidence = {}) => {
    report.assertions.push({ name, passed: Boolean(passed), evidence });
    if (!passed) throw new Error(`Acceptance assertion failed: ${name}`);
  };

  let processState;
  let cdp;
  let signalProcessId = 0;
  let normalCloseRequested = false;
  const overallTimer = setTimeout(() => {
    processState?.child.kill();
  }, overallTimeoutMs);

  try {
    const cdpPort = await getFreeLoopbackPort();
    processState = launchTranslator(testData, cdpPort);
    assert('translator-started-in-isolation', Boolean(processState.child.pid), {
      translatorProcessId: processState.child.pid,
      userData: testData.userData,
    });
    cdp = await connectToTranslator(cdpPort, processState);
    await enterDevelopmentWorkspace(cdp);
    const profile = await ensureSignalProfile(cdp);
    if (profile.created) await reloadAndEnter(cdp);
    await clickSignalApplication(cdp);

    const profileId = profile.id;
    report.profileId = profileId;
    const control = await waitForSignalControl(testData, profileId);
    signalProcessId = control.entry.processId;
    report.translatorProcessId = processState.child.pid;
    report.signalProcessId = signalProcessId;
    const guard = await waitForAcceptedGuard(testData, profileId);
    assert('launcher-credential-accepted', guard.diagnostic.stage === 'credential-accepted', {
      diagnosticPath: guard.diagnosticPath,
    });

    const visibleSnapshot = await waitFor(() => {
      const snapshot = runProbe('Snapshot', {
        translatorProcessId: processState.child.pid,
        signalProcessId,
      });
      const translatorWindow = primaryWindow(snapshot, processState.child.pid, true);
      const signalWindow = primaryWindow(snapshot, signalProcessId, true);
      return translatorWindow && signalWindow ? { snapshot, translatorWindow, signalWindow } : null;
    }, 'visible translator and Signal windows', visibleWindowTimeoutMs, 700);

    assert('source-executable-is-exact', sameWindowsPath(
      visibleSnapshot.snapshot.signalImagePath,
      source.executable
    ), {
      expected: source.executable,
      actual: visibleSnapshot.snapshot.signalImagePath,
    });
    assert('source-control-channel-authenticated', control.entry.connected === true, {
      statusPath: control.statusPath,
      processId: control.entry.processId,
    });
    assert('signal-main-window-owner-is-translator',
      visibleSnapshot.signalWindow.ownerHandle === visibleSnapshot.translatorWindow.handle &&
      visibleSnapshot.signalWindow.ownerProcessId === processState.child.pid,
      {
        signalHandle: visibleSnapshot.signalWindow.handle,
        ownerHandle: visibleSnapshot.signalWindow.ownerHandle,
        translatorHandle: visibleSnapshot.translatorWindow.handle,
      }
    );
    assert('signal-window-is-visible', visibleSnapshot.signalWindow.visible === true, {
      signalHandle: visibleSnapshot.signalWindow.handle,
      signalRect: visibleSnapshot.signalWindow.rect,
    });
    runProbe('Capture', {
      translatorProcessId: processState.child.pid,
      signalProcessId,
      handle: visibleSnapshot.translatorWindow.handle,
      outputPath: testData.visibleCapture,
    });
    assert('visible-desktop-capture-written', (await fsp.stat(testData.visibleCapture)).size > 10_000, {
      path: testData.visibleCapture,
    });

    const externallyBlurred = runProbe('FocusExternalWindow', {
      translatorProcessId: processState.child.pid,
      signalProcessId,
    });
    const externallyBlurredSignalWindow = primaryWindow(externallyBlurred, signalProcessId, true);
    assert('external-focus-keeps-signal-visible', Boolean(externallyBlurredSignalWindow), {
      signalHandle: externallyBlurredSignalWindow?.handle,
      externalTarget: 'temporary external probe window',
    });

    await cdp.evaluate('window.windowControl.minimize()');
    const minimized = await waitFor(() => {
      const snapshot = runProbe('Snapshot', {
        translatorProcessId: processState.child.pid,
        signalProcessId,
      });
      const translatorWindow = primaryWindow(snapshot, processState.child.pid, false);
      return translatorWindow?.iconic && allSignalWindowsHidden(snapshot, signalProcessId)
        ? { snapshot, translatorWindow }
        : null;
    }, 'Signal hide on translator minimize', 10_000, 500);
    assert('translator-minimize-hides-signal', allSignalWindowsHidden(
      minimized.snapshot,
      signalProcessId
    ));

    runProbe('Restore', {
      translatorProcessId: processState.child.pid,
      signalProcessId,
      handle: minimized.translatorWindow.handle,
    });
    const restored = await waitFor(() => {
      const snapshot = runProbe('Snapshot', {
        translatorProcessId: processState.child.pid,
        signalProcessId,
      });
      const translatorWindow = primaryWindow(snapshot, processState.child.pid, true);
      const signalWindow = primaryWindow(snapshot, signalProcessId, true);
      return translatorWindow && signalWindow ? { snapshot, translatorWindow, signalWindow } : null;
    }, 'Signal restore with the translator', 15_000, 500);
    assert('translator-restore-shows-owned-signal',
      restored.signalWindow.ownerHandle === restored.translatorWindow.handle,
      {
        signalHandle: restored.signalWindow.handle,
        ownerHandle: restored.signalWindow.ownerHandle,
      }
    );

    await cdp.evaluate('window.chatTranslator.engageLockScreen()', 20_000);
    const locked = await waitFor(() => {
      const snapshot = runProbe('Snapshot', {
        translatorProcessId: processState.child.pid,
        signalProcessId,
      });
      return allSignalWindowsHidden(snapshot, signalProcessId) ? snapshot : null;
    }, 'the main-process lock visibility gate', 10_000, 350);
    assert('lock-gate-hides-every-signal-window', allSignalWindowsHidden(locked, signalProcessId));
    assert('lock-ack-keeps-authenticated-source-process-alive',
      sameWindowsPath(locked.signalImagePath, source.executable) && pidIsAlive(signalProcessId),
      { signalProcessId, imagePath: locked.signalImagePath }
    );

    runProbe('Capture', {
      translatorProcessId: processState.child.pid,
      signalProcessId,
      handle: restored.translatorWindow.handle,
      outputPath: testData.lockedCapture,
    });
    assert('locked-desktop-capture-written', (await fsp.stat(testData.lockedCapture)).size > 10_000, {
      path: testData.lockedCapture,
    });

    normalCloseRequested = true;
    await cdp.evaluate('window.windowControl.close()').catch(() => undefined);
    const translatorExited = await waitForExit(processState.child, 15_000);
    assert('translator-exits-cleanly', translatorExited, { exitCode: processState.child.exitCode });
    const signalExited = await waitFor(() => !pidIsAlive(signalProcessId), 'Signal child shutdown', 10_000, 250)
      .then(() => true)
      .catch(() => false);
    assert('signal-child-exits-with-translator', signalExited, { signalProcessId });

    report.result = 'passed';
    await writeReport(testData, report);
    console.log(`signal-source-window-ui: passed`);
    console.log(`report=${testData.reportPath}`);
    console.log(`visibleCapture=${testData.visibleCapture}`);
    console.log(`lockedCapture=${testData.lockedCapture}`);
  } catch (error) {
    report.result = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    report.processOutputTail = processState?.output().slice(-16 * 1024) || '';
    await writeReport(testData, report).catch(() => undefined);
    throw new Error(`${report.error} Report: ${testData.reportPath}`);
  } finally {
    clearTimeout(overallTimer);
    cdp?.close();
    if (processState?.child && processState.child.exitCode === null) {
      if (normalCloseRequested) await waitForExit(processState.child, 3000);
      if (processState.child.exitCode === null) {
        try {
          processState.child.kill();
        } catch {
          // The test-owned translator process already exited.
        }
      }
      await waitForExit(processState.child, 3000);
    }
    if (signalProcessId && pidIsAlive(signalProcessId)) {
      try {
        const snapshot = runProbe('Snapshot', {
          translatorProcessId: processState?.child.pid || process.pid,
          signalProcessId,
        });
        if (sameWindowsPath(snapshot.signalImagePath, source.executable)) {
          process.kill(signalProcessId);
        }
      } catch {
        // Cleanup is restricted to the exact source executable and test-owned PID.
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
