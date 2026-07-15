const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readBuffer = relativePath => fs.readFileSync(path.join(root, relativePath));
const defaultBaselineVersion = '8.18.0';
const supportedBaselines = Object.freeze({
  '8.17.0': '6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052',
  '8.18.0': 'E25AA0F8308BF5DB04A41D3ED12E4F717884AFCC118BA639786A3AE523C7D1D6'
});

function selectBaselineVersion(argv) {
  if (argv.length === 0) return defaultBaselineVersion;
  if (argv.length !== 2 || argv[0] !== '--version') {
    throw new Error('Usage: node tools/test-signal-source-compatibility.cjs [--version <8.17.0|8.18.0>]');
  }
  const version = argv[1];
  if (!Object.hasOwn(supportedBaselines, version)) {
    throw new Error(`Unsupported Signal source baseline version: ${version}`);
  }
  return version;
}

const baselineVersion = selectBaselineVersion(process.argv.slice(2));
const versionDirectory = `v${baselineVersion}`;
const contract = JSON.parse(read(`signal-source/compatibility/${versionDirectory}.json`));
const baselineManifest = JSON.parse(read(`signal-source/baselines/${versionDirectory}.json`));

assert.deepEqual(
  baselineManifest.build.installArgs,
  ['pnpm', 'install', '--offline', '--frozen-lockfile'],
  'Signal dependency installation must never probe the network'
);
assert.equal(
  baselineManifest.build.electronArchiveSha256,
  '01889FF05A2852B86F34E274F0FD7DC41F31CCC500A8D4E07D43F4984B8CEC9A'
);
const experimentScript = read('tools/signal-source-experiment.cjs');
for (const marker of [
  "COREPACK_ENABLE_NETWORK: '0'",
  'checkOfflineWindowsBuildInputs',
  'Electron archive cache',
  'Electron native headers',
  'Writable offline pnpm store',
  'MAOYI_SIGNAL_SOURCE_REUSE_DEPENDENCIES',
  'Reusable Signal dependency lock does not match the exact source lock',
  'electron:install-app-deps',
  "'@signalapp/windows-ucv'",
  "'--publish'",
  "'--config.electronDist'",
  'only final release packaging will run'
]) {
  assert.ok(experimentScript.includes(marker), `missing offline build marker: ${marker}`);
}

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.baseline, baselineVersion);
assert.equal(contract.referenceDelivery, '003');
assert.equal(contract.targetDelivery, '006');
assert.equal(contract.rules.referenceDeliveryIsUpgradeTarget, false);
assert.equal(contract.rules.preserveReferenceCapabilities, true);
assert.equal(contract.rules.launcherOnly, true);
assert.equal(contract.rules.launcherProductName, 'maoyi');
assert.equal(contract.rules.localDirectLaunchAction, 'block-without-reset');
assert.equal(contract.rules.foreignWholeFolderLaunchAction, 'full-data-root-reset-before-signal-load');
assert.equal(contract.rules.officialSignalFallback, false);
assert.equal(contract.rules.replaceCurrentRuntimeBeforeAcceptance, false);

const requiredCapabilities = [
  'launcher-only-start',
  'local-direct-block-without-reset',
  'foreign-whole-folder-full-reset',
  'guard-before-account-database',
  'no-official-signal-fallback',
  'profile-data-isolation',
  'authenticated-control-channel',
  'window-show-hide-bounds-shutdown-heartbeat',
  'english-bubble-to-chinese',
  'chinese-composer-to-english',
  'encrypted-cache-restoration',
  'signal-a-b-a-cache-restoration',
  'unread-notification-bridge',
  'event-driven-window-sync-without-800ms-polling',
  'typed-command-bridge',
  'windows-owner-window',
  'main-process-lock-visibility-gate'
];
if (baselineVersion === '8.18.0') {
  requiredCapabilities.push('source-message-added-live-translation');
  requiredCapabilities.push('source-bubble-manual-refresh');
}
const capabilityIds = contract.capabilities.map(item => item.id);
assert.deepEqual(capabilityIds, requiredCapabilities);

const patchSeriesDirectory = `signal-source/patches/${versionDirectory}`;
const patchSeries = JSON.parse(read(`${patchSeriesDirectory}/series.json`));
assert.equal(patchSeries.schemaVersion, 1);
assert.equal(patchSeries.baseline, baselineVersion);
const expectedPatchSeries = [
  {
    file: '0001-maoyi-launcher-startup-guard.patch',
    sha256: 'DE7BAEA1511C856AA4681F9F1689701D414FC67371C716656902640685C9136A'
  },
  {
    file: '0002-maoyi-typed-control-bridge.patch',
    sha256: 'E4268FA2FAE0FBAEEA6ABF463C5A91CACD0F917E43C82211DA30DF76DB83B632'
  },
  {
    file: '0003-maoyi-window-security-controller.patch',
    sha256: '78CDC75C460C6CC398585FCECF51FD74556F01E32CBC37E3D4D22C337E0685CD'
  }
];
if (baselineVersion === '8.18.0') {
  expectedPatchSeries.push({
    file: '0004-maoyi-source-translation-cache-bridge.patch',
    sha256: 'E1A261466D7D9F6C38896C7236C9E27067871320123F0BE86EE00A09ADF8F7A8'
  });
  expectedPatchSeries.push({
    file: '0005-maoyi-realtime-message-translation.patch',
    sha256: '43B1CBDDF3E1A9C5CDBD0B03EAA33BC464D63A214880D26F495045635823DFD6'
  });
  expectedPatchSeries.push({
    file: '0006-maoyi-source-bubble-refresh.patch',
    sha256: '1E124603EC29EFE3F4B4090D70DCC9F891F48D253C5ED174CD6668B0B4A8E7A6'
  });
  expectedPatchSeries.push({
    file: '0007-maoyi-incoming-auto-translation-stability.patch',
    sha256: 'F260FAC184A6080E4055CF2BEA8205987841430B8DCF4E834DD0081594656B02'
  });
}
assert.deepEqual(patchSeries.patches, expectedPatchSeries);

for (const entry of patchSeries.patches) {
  const patchSha256 = crypto
    .createHash('sha256')
    .update(readBuffer(`${patchSeriesDirectory}/${entry.file}`))
    .digest('hex')
    .toUpperCase();
  assert.equal(patchSha256, entry.sha256, `patch SHA-256 mismatch: ${entry.file}`);
}
const patchSetSha256 = crypto.createHash('sha256').update(JSON.stringify({
  schemaVersion: patchSeries.schemaVersion,
  baseline: patchSeries.baseline,
  patches: patchSeries.patches.map(entry => ({ file: entry.file, sha256: entry.sha256 }))
})).digest('hex').toUpperCase();
assert.equal(
  patchSetSha256,
  supportedBaselines[baselineVersion],
  `unapproved Signal ${baselineVersion} patch set`
);

const startupPatch = read(`${patchSeriesDirectory}/${patchSeries.patches[0].file}`);
for (const expected of [
  'app/maoyi/bootstrap.main.ts',
  'app/maoyi/launchGuard.main.ts',
  'credential-accepted',
  'signal-main.js',
  'isMaoyiEmbedLaunch() || app.requestSingleInstanceLock()',
  'updatesEnabled: false'
]) {
  assert.ok(startupPatch.includes(expected), `missing startup source-patch marker: ${expected}`);
}

const bridgePatch = read(`${patchSeriesDirectory}/${patchSeries.patches[1].file}`);
for (const expected of [
  'app/maoyi/controlBridge.main.ts',
  'app/maoyi/controlProtocol.main.ts',
  'maoyi-signal-control-auth-v1',
  'maoyi-signal-control-message-v1',
  'main-to-signal',
  'signal-to-main',
  'verifyMaoyiLauncherEnvelope'
]) {
  assert.ok(bridgePatch.includes(expected), `missing typed-bridge source-patch marker: ${expected}`);
}

const windowSecurityPatch = read(`${patchSeriesDirectory}/${patchSeries.patches[2].file}`);
for (const expected of [
  'app/maoyi/windowController.main.ts',
  'app/maoyi/windowsOwner.node.ts',
  'security.visibility-applied',
  'window.owner-attached',
  'GWLP_HWNDPARENT',
  'GetWindowThreadProcessId',
  'skipTaskbar: true',
  'maoyiWindowController?.markRuntimeReady()',
  "case 'script.execute'"
]) {
  assert.ok(windowSecurityPatch.includes(expected), `missing window-security source-patch marker: ${expected}`);
}

if (baselineVersion === '8.18.0') {
  const translationCachePatch = read(`${patchSeriesDirectory}/${patchSeries.patches[3].file}`);
  for (const expected of [
    'app/maoyi/messageBridge.main.ts',
    'ts/maoyi/messageBridge.preload.ts',
    'ts/maoyi/translationRuntime.preload.ts',
    'message.visibleBatch',
    'translation.cacheResultBatch',
    'module-message__maoyi-translation'
  ]) {
    assert.ok(
      translationCachePatch.includes(expected),
      `missing translation-cache source-patch marker: ${expected}`
    );
  }
  const realtimeMessagePatch = read(`${patchSeriesDirectory}/${patchSeries.patches[4].file}`);
  for (const expected of [
    'ts/maoyi/messageAddedObserver.std.ts',
    'message.added',
    'MESSAGES_ADDED',
    'MaoyiAddedMessageLedger',
    'publishMaoyiAddedMessage'
  ]) {
    assert.ok(
      realtimeMessagePatch.includes(expected),
      `missing realtime-message source-patch marker: ${expected}`
    );
  }
  const bubbleRefreshPatch = read(`${patchSeriesDirectory}/${patchSeries.patches[5].file}`);
  for (const expected of [
    'translation.refresh.request',
    'requestMaoyiTranslationRefresh',
    'module-message__maoyi-translation-refresh',
    'module-message__maoyi-translation-tail',
    '{this.renderMaoyiTranslationRefresh()}',
    'const characters = Array.from(maoyiTranslationText)',
    "const lastCharacter = characters.pop() ?? ''",
    'margin: 0 0 0 3px',
    'color: #0b7654',
    'color: #f8fbff',
    'sourceBubbleRefreshContract_test.node.ts'
  ]) {
    assert.ok(
      bubbleRefreshPatch.includes(expected),
      `missing source-bubble-refresh patch marker: ${expected}`
    );
  }
  assert.ok(
    !bubbleRefreshPatch.includes('module-message__maoyi-translation-footer'),
    'source-bubble-refresh patch must not restore the old footer row'
  );
  const incomingStabilityPatch = read(`${patchSeriesDirectory}/${patchSeries.patches[6].file}`);
  for (const expected of [
    'message.contact.length > 0',
    'conversationEpoch',
    'does not drop a queued added message',
    'decoded empty contact list'
  ]) {
    assert.ok(
      incomingStabilityPatch.includes(expected),
      `missing incoming-stability patch marker: ${expected}`
    );
  }
}

const sourceExperimentTool = read('tools/signal-source-experiment.cjs');
assert.ok(sourceExperimentTool.includes('GIT_CEILING_DIRECTORIES'));

const guard = read('signal-guard/df-bootstrap.cjs');
assert.match(guard, /local-direct-blocked/);
assert.match(guard, /缺少启动器，请从maoyi启动/);
assert.match(guard, /foreign-initializing/);
assert.match(guard, /缺少启动器，正在初始化/);
assert.match(guard, /credential-accepted/);

const runtimeSecurityTest = read('tools/test-runtime-security.mjs');
assert.match(runtimeSecurityTest, /runCloneResetWorker/);
assert.match(runtimeSecurityTest, /credential and full-reset checks passed/);

const main = read('electron/main.ts');
assert.ok(
  main.includes(`'${baselineVersion}': '${supportedBaselines[baselineVersion]}'`),
  `translator does not approve the exact Signal ${baselineVersion} patch set`
);
for (const expected of [
  'launchSignalProfile',
  'hideSignalProfile',
  'hideAllSignalWindows',
  "'window.show'",
  "'window.hide'",
  "type: 'heartbeat.ack'",
  "type: 'window.owner'",
  "type: 'security.visibility'",
  "message.type === 'security.visibility-applied'",
  '!workspaceVisibilityGate.locked',
  "join(developmentProjectRoot, '.tmp', 'signal-source-ui')",
  'realpathSync.native',
  'MAOYI_SIGNAL_SOURCE_SHA256',
  'supportedSignalSourcePatchSets',
  '.df-signal-source-runtime-copy.json',
  'hashFileSha256(candidate)',
  "basename(unpackedRoot).toLowerCase() !== 'win-unpacked'"
]) {
  assert.ok(main.includes(expected), `missing current Signal compatibility marker: ${expected}`);
}
if (baselineVersion === '8.18.0') {
  for (const expected of [
    "message.type === 'message.added'",
    'SIGNAL_LIVE_TRANSLATION_QUEUE_START',
    'task.abortController.signal',
    'isValidSignalTranslationProjection'
  ]) {
    assert.ok(main.includes(expected), `missing realtime Signal translation marker: ${expected}`);
  }
}
assert.ok(
  !main.includes('return [experimentExecutable, developmentExecutable]'),
  'Signal source experiment must never fall back to the legacy development runtime'
);

const planZh = read('SIGNAL_SOURCE_INTEGRATION_PLAN.md');
const planEn = read('SIGNAL_SOURCE_INTEGRATION_PLAN.en.md');
assert.ok(planZh.includes('`003` 功能兼容合同'));
assert.ok(planZh.includes('Signal 整个运行文件夹及其数据被复制到非本机后单独启动'));
assert.ok(planEn.includes('Suite `003` Capability-Compatibility Contract'));
assert.ok(planEn.includes('complete Signal runtime folder and its data are copied to a foreign machine'));

console.log(
  `signal-source-compatibility (${baselineVersion}): launcher, clone reset, ` +
  'feature preservation, and source-upgrade contracts passed'
);
