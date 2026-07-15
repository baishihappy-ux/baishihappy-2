const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function includes(source, expected, contract) {
  assert.ok(source.includes(expected), `Lock-screen contract missing: ${contract}`);
}

function matches(source, pattern, contract) {
  assert.match(source, pattern, `Lock-screen contract missing: ${contract}`);
}

function excludes(source, unexpected, contract) {
  assert.ok(!source.includes(unexpected), `Lock-screen contract regressed: ${contract}`);
}

function functionBody(source, startMarker, endMarker, contract) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Lock-screen contract missing: ${contract} start`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Lock-screen contract missing: ${contract} end`);
  return source.slice(start, end);
}

const app = read('src/App.vue');
const main = read('electron/main.ts');
const preloadTs = read('electron/preload.ts');
const preloadCjs = read('electron/preload.cjs');
const shared = read('electron/shared.ts');

// Renderer contract: 15-minute idle lock, exact safety copy, 6+2 input, and the new sidebar entry.
matches(app, /const lockScreenIdleMs = 15 \* 60 \* 1000;/, '15-minute automatic lock');
includes(app, '为保障您的安全，在密码设置过程中，请勿连接互联网。', 'offline safety notice');
includes(app, '请拔掉电脑的网线且关闭 WIFI 无线网络连接，完成后点击继续。', 'disconnect-network instruction');
matches(app, /const lockScreenDigitLength = 6;[\s\S]*const lockScreenLetterLength = 2;[\s\S]*const lockScreenCredentialLength = lockScreenDigitLength \+ lockScreenLetterLength;/, '6+2 credential lengths');
matches(app, /const normalized = letter\.toUpperCase\(\);[\s\S]*\/\^\[A-Z\]\$\//, 'case-insensitive ASCII letter normalization');
includes(app, '请用实体键盘输入 ${lockScreenLetterLength} 位字母（不区分大小写）', 'physical-keyboard letter prompt');
includes(app, 'class="runtime-lock-button" @click="handleLockButtonClick"', 'sidebar lock button');
includes(app, 'class="runtime-lock-key" aria-hidden="true"', 'themeable vertical rounded key icon');
excludes(app, 'runtime-lock-shield', 'lock entry must not use the former shield icon');
includes(read('src/styles.css'), 'lock-key-hd-transparent-cropped.png', 'validated transparent HD key artwork mask');
includes(app, 'lockGuideVisible.value = !status.enabled;', 'guide visibility restored from persisted lock status');
includes(app, 'v-if="lockGuideVisible && !lockScreenStatus?.enabled"', 'first-setup guide bubble');
excludes(app, 'handleRuntimeLogoClick', 'Logo must not open lock-screen setup');
excludes(app, 'lockLogoClick', 'Logo triple-click state must stay removed');

// Main-process contract: protected v2 state, fail-closed corruption handling, and fail-closed offline checks.
matches(main, /import \{[\s\S]*safeStorage[\s\S]*\} from 'electron';/, 'Electron safeStorage import');
matches(main, /import \{[\s\S]*networkInterfaces[\s\S]*\} from 'node:os';/, 'networkInterfaces import');
includes(main, "'route.exe'", 'local Windows route-table check');
includes(main, 'const first = await sampleNetworkOffline();', 'first offline sample');
includes(main, 'const second = await sampleNetworkOffline();', 'second offline sample');
includes(main, 'if (first.uncertain || second.uncertain)', 'uncertain network result fails closed');
includes(main, 'if (!first.offline || !second.offline)', 'both network samples must be offline');
matches(main, /type ProtectedLockScreenState = LockScreenStateBase & \{[\s\S]*version: 2;[\s\S]*protectedCredential: string;/, 'v2 protected credential state');
includes(main, 'protectedCredential: protectLockCredential({', 'credential encrypted before persistence');
includes(main, "credentialFormat: 'digits6-letters2'", 'v2 6+2 credential format');
matches(main, /function unreadableLockScreenState[\s\S]*enabled: true,[\s\S]*failedAttempts: lockScreenMaxAttempts/, 'corrupt state remains locked');
includes(main, "return unreadableLockScreenState('锁屏状态文件格式无效');", 'invalid state fails closed');
includes(main, "if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;", 'only a missing first-use state is treated as unset');

const saveFlow = functionBody(
  main,
  'async function setLockScreenPin(',
  '\nasync function unlockLockScreen(',
  'credential save flow'
);
const consumeIndex = saveFlow.indexOf('consumeLockPinChangeAuthorization');
const stateCheckIndex = saveFlow.indexOf('authorization.stateVersion');
const networkRecheckIndex = saveFlow.indexOf('await inspectNetworkOfflineTwice()');
const writeIndex = saveFlow.indexOf('await writeLockScreenState(state)');
assert.ok(consumeIndex >= 0, 'Lock-screen contract missing: one-use change authorization');
assert.ok(stateCheckIndex > consumeIndex, 'Lock-screen contract missing: state-bound change authorization');
assert.ok(networkRecheckIndex > stateCheckIndex, 'Lock-screen contract missing: network recheck before save');
assert.ok(writeIndex > networkRecheckIndex, 'Lock-screen contract missing: offline verification must precede persistence');

includes(shared, "export type LockScreenPinChangeMode = 'setup' | 'reset' | 'upgrade';", 'setup/reset/upgrade modes');
includes(main, "if (mode === 'setup') return !state?.enabled;", 'setup state gate');
includes(main, "if (mode === 'reset') return Boolean(state?.enabled && state.failedAttempts >= lockScreenMaxAttempts);", 'reset failure-count gate');
includes(main, 'legacyUpgradeAuthorizedUntil >= now', 'legacy upgrade unlock gate');
includes(main, "const token = randomBytes(32).toString('base64url');", 'unguessable change authorization');
includes(main, 'lockPinChangeAuthorizations.delete(token);', 'one-use authorization consumption');
includes(main, 'authorization.senderId !== senderId', 'authorization sender binding');
includes(main, 'authorization.expiresAt <= Date.now()', 'authorization expiry gate');

// Window chrome contract: the native title-bar overlay is disabled at creation and
// theme changes must not call Electron's object-only runtime overlay API with a boolean.
includes(main, 'titleBarOverlay: false,', 'native title-bar overlay disabled at window creation');
excludes(main, 'setTitleBarOverlay', 'theme IPC must not mutate the disabled native title-bar overlay');

// IPC contract: TypeScript preload, packaged CommonJS preload, shared types, and main handlers stay aligned.
const ipcContracts = [
  ['getLockScreenStatus', 'lock-screen:status'],
  ['engageLockScreen', 'lock-screen:engage'],
  ['checkNetworkOffline', 'lock-screen:check-network-offline'],
  ['authorizeLockScreenPinChange', 'lock-screen:authorize-pin-change'],
  ['setLockScreenPin', 'lock-screen:set-pin'],
  ['unlockLockScreen', 'lock-screen:unlock']
];

for (const [method, channel] of ipcContracts) {
  includes(preloadTs, `${method}:`, `TypeScript preload method ${method}`);
  includes(preloadTs, `'${channel}'`, `TypeScript preload channel ${channel}`);
  includes(preloadCjs, `${method}:`, `packaged preload method ${method}`);
  includes(preloadCjs, `'${channel}'`, `packaged preload channel ${channel}`);
  includes(shared, `${method}:`, `shared API method ${method}`);
  includes(main, `trustedHandle('${channel}'`, `main IPC handler ${channel}`);
}

matches(preloadTs, /setLockScreenPin: \(pin: string, token: string\) => ipcRenderer\.invoke\('lock-screen:set-pin', pin, token\)/, 'TypeScript preload forwards the change token');
matches(preloadCjs, /setLockScreenPin: \(pin, token\) => ipcRenderer\.invoke\('lock-screen:set-pin', pin, token\)/, 'packaged preload forwards the change token');
includes(shared, 'setLockScreenPin: (pin: string, token: string) => Promise<LockScreenSetPinResult>;', 'shared set-pin token signature');
includes(app, 'await window.chatTranslator?.engageLockScreen?.();', 'renderer waits for the main-process lock gate');
includes(main, 'let workspaceVisibilityGate = { locked: true, revision: 0 };', 'workspace visibility starts fail-closed');
includes(main, 'message.type === \'security.visibility-applied\'', 'Signal lock acknowledgement handling');
includes(main, 'message.visibleWindowCount === 0', 'Signal acknowledgement requires every window hidden');
includes(main, 'terminateSignalInstanceFailClosed(appId)', 'unresponsive Signal instances are terminated before lock completion');
includes(main, 'if (child.exitCode === null) liveAppIds.add(signalAppId(profileId));', 'all non-exited Signal children remain in the lock set');
excludes(main, 'if (child.exitCode === null && !child.killed) liveAppIds.add(signalAppId(profileId));', 'a sent kill signal must not remove a still-running Signal child from the lock set');
includes(main, "process.kill(processId, 'SIGKILL');", 'authenticated Signal PID receives forced termination after graceful timeout');
matches(main, /const exitedGracefully = await waitForSignalProcessExit[\s\S]*forceTerminateSignalProcess[\s\S]*failedProcessIds\.add/, 'graceful and forced Signal termination are both confirmed');
includes(main, 'Workspace remains locked because Signal termination could not be confirmed', 'unconfirmed Signal termination fails the lock request explicitly');
matches(main, /finally \{[\s\S]*client\?\.socket\.destroy\(\);[\s\S]*signalControlClients\.delete\(appId\);[\s\S]*signalControlSessions\.delete\(appId\);/, 'Signal control state is cleaned before a termination failure is reported');
matches(main, /function canShowSignalWindows\(\)[\s\S]*!workspaceVisibilityGate\.locked/, 'Signal visibility checks the main-process lock truth');
matches(main, /async function executeSignalScript[\s\S]*workspaceVisibilityGate\.locked/, 'Signal scripts are rejected while locked');

console.log('lock-screen-contract: static contracts passed');
