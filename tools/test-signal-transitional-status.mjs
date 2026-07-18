import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildSignalSourceOnlyAcceptanceDiagnostic,
  isTransientSignalScriptGateError,
  signalSourceOnlyAcceptanceStages,
  signalTranslationAcceptancePolicy
} from '../dist-electron/shared.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(projectRoot, 'src', 'App.vue'), 'utf8');
const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.ts'), 'utf8');
const preloadTs = fs.readFileSync(path.join(projectRoot, 'electron', 'preload.ts'), 'utf8');
const preloadCjs = fs.readFileSync(path.join(projectRoot, 'electron', 'preload.cjs'), 'utf8');

function topLevelFunctionSource(source, name) {
  const header = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(header, `missing function ${name}`);
  const tail = source.slice(header.index + header[0].length);
  const next = /\n(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/.exec(tail);
  return source.slice(header.index, next ? header.index + header[0].length + next.index : source.length);
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source markers ${startMarker}`);
  return source.slice(start + startMarker.length, end);
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

assert.equal(isTransientSignalScriptGateError(new Error('Workspace is locked.')), true);
assert.equal(
  isTransientSignalScriptGateError(
    new Error("Error invoking remote method 'signal:execute-script': Error: Signal script execution is unavailable while locked")
  ),
  true
);
assert.equal(
  isTransientSignalScriptGateError(
    new Error('Signal control channel is not connected for Signal Source UI Acceptance.')
  ),
  true
);
assert.equal(isTransientSignalScriptGateError(new Error('Signal control channel disconnected')), false);

assert.deepEqual(signalTranslationAcceptancePolicy('signal'), {
  legacyBubbleEnabled: false,
  composerEnabled: true
});
assert.deepEqual(signalTranslationAcceptancePolicy('signal', false), {
  legacyBubbleEnabled: false,
  composerEnabled: true
});
assert.deepEqual(signalTranslationAcceptancePolicy('signal', true), {
  legacyBubbleEnabled: false,
  composerEnabled: true
});
for (const platform of ['whatsapp', 'telegram-a', 'telegram-k']) {
  assert.deepEqual(signalTranslationAcceptancePolicy(platform, true), {
    legacyBubbleEnabled: true,
    composerEnabled: true
  });
}

const stageCounts = Object.fromEntries(signalSourceOnlyAcceptanceStages.map(stage => [stage, 0]));
stageCounts['mode-active'] = 1;
stageCounts.completed = 1;
stageCounts.text = 'BODY-SENTINEL-DO-NOT-PERSIST';
stageCounts.contactTitle = 'CONTACT-SENTINEL-DO-NOT-PERSIST';
stageCounts.messageId = '11111111-2222-4333-8444-555555555555';
const diagnostic = buildSignalSourceOnlyAcceptanceDiagnostic('completed', stageCounts, 123);
const expectedStages = Object.fromEntries(signalSourceOnlyAcceptanceStages.map(stage => [stage, 0]));
expectedStages['mode-active'] = 1;
expectedStages.completed = 1;
assert.deepEqual(diagnostic, {
  schemaVersion: 1,
  type: 'source-only-acceptance-summary',
  baseline: '8.18.0',
  patchSetSha256: 'BF482ACA5FEB79AFD4B0C418E56DF41BEA3C38F284EF8FBDB64C1BF17F5D2650',
  mode: 'source-only',
  legacyBubbleEnabled: false,
  composerEnabled: true,
  elapsedMs: 123,
  lastStage: 'completed',
  stages: expectedStages
});
const forbiddenKeys = new Set([
  'text', 'sourceText', 'body', 'contactId', 'contactTitle', 'contactRemark',
  'conversationId', 'messageId', 'profileId', 'requestId', 'appId', 'id'
]);
for (const key of collectKeys(diagnostic)) {
  assert.equal(forbiddenKeys.has(key), false, `source-only diagnostic leaked forbidden key ${key}`);
}
const serializedDiagnostic = JSON.stringify(diagnostic);
for (const sentinel of [
  'BODY-SENTINEL-DO-NOT-PERSIST',
  'CONTACT-SENTINEL-DO-NOT-PERSIST',
  '11111111-2222-4333-8444-555555555555'
]) {
  assert.equal(serializedDiagnostic.includes(sentinel), false, `diagnostic leaked ${sentinel}`);
}

assert.match(app, /signalTranslationAcceptancePolicy/);
const signalRuntime = topLevelFunctionSource(app, 'startSignalTranslationRuntime');
assert.match(signalRuntime, /buildSignalLegacyBubbleRuntimeRetirementScript/);
assert.match(signalRuntime, /if \(legacyBubbleDisabled\)/);
const legacyBubbleRetirement = topLevelFunctionSource(app, 'buildSignalLegacyBubbleRuntimeRetirementScript');
assert.match(legacyBubbleRetirement, /__dfCachedTranslationObserver\?\.disconnect/);
assert.match(legacyBubbleRetirement, /\.df-chat-translation, \.df-chat-refresh-translation/);
assert.match(legacyBubbleRetirement, /delete window\.__dfApplyCachedTranslations/);
assert.match(app, /const signalSourceOnlyAcceptance = ref\(false\)/);
assert.match(app, /window\.chatTranslator\.getSignalSourceOnlyAcceptance\(\)/);
for (const name of [
  'enqueueMessageTranslationTask',
  'installCachedTranslationRuntime',
  'refreshProfileCachedTranslations',
  'scheduleProfileTranslationRefresh',
  'startSignalTranslationRuntime',
  'startTranslationBridge',
  'scanAndTranslateMessages',
  'scheduleHistoryRenderPrefetch',
  'preRenderHistoryCachedTranslations'
]) {
  assert.match(
    topLevelFunctionSource(app, name),
    /isSignalLegacyBubbleTranslationDisabled/,
    `${name} must enforce the Signal source-only legacy-bubble gate`
  );
}
const scanSource = topLevelFunctionSource(app, 'scanAndTranslateMessages');
assert.ok(
  scanSource.indexOf('isSignalLegacyBubbleTranslationDisabled') < scanSource.indexOf('buildMessageScanScript'),
  'Signal legacy bubble scanning must stop before the first DOM message scan'
);
for (const name of [
  'startComposerInstallLoop',
  'enqueueComposerTranslation',
  'warmSignalComposerTranslation',
  'handleInjectedComposerEvent'
]) {
  const composerSource = topLevelFunctionSource(app, name);
  assert.doesNotMatch(composerSource, /signalSourceOnlyAcceptance|isSignalLegacyBubbleTranslationDisabled/);
}

assert.match(main, /MAOYI_SIGNAL_SOURCE_ONLY_ACCEPTANCE/);
assert.match(main, /signalSourceExperimentMetadata\?\.version !== '8\.18\.0'/);
assert.match(main, /!signalSourceExperimentMetadata\.isolatedRuntimeCopy/);
assert.match(main, /process\.argv\.some\(argument => argument\.startsWith\('--remote-debugging-'\)\)/);
assert.match(main, /signal-source-only-acceptance-summary\.json/);
assert.match(main, /trustedHandle\('signal:source-only-acceptance'/);
assert.match(preloadTs, /getSignalSourceOnlyAcceptance: \(\) => ipcRenderer\.invoke\('signal:source-only-acceptance'\)/);
assert.match(preloadCjs, /getSignalSourceOnlyAcceptance: \(\) => ipcRenderer\.invoke\('signal:source-only-acceptance'\)/);

const diagnosticSource = sourceBetween(
  main,
  '// SIGNAL_SOURCE_ONLY_ACCEPTANCE_DIAGNOSTICS_START',
  '// SIGNAL_SOURCE_ONLY_ACCEPTANCE_DIAGNOSTICS_END'
);
assert.doesNotMatch(diagnosticSource, /appendSignalTranslationDebugLog/);
assert.doesNotMatch(
  diagnosticSource,
  /\b(?:sourceText|body|contactId|contactTitle|contactRemark|conversationId|messageId|profileId|requestId|appId|id)\b/
);
const refreshSource = topLevelFunctionSource(main, 'scheduleSignalLiveTranslationRefresh');
assert.ok(
  refreshSource.indexOf("sendSignalControlMessage(task.appId, snapshotRequest)") <
    refreshSource.indexOf("appendSignalSourceOnlyAcceptanceStage('snapshot-request-sent')"),
  'snapshot success must only be recorded after the request is stored and sent'
);
const controlSource = topLevelFunctionSource(main, 'handleSignalControlMessage');
assert.ok(
  controlSource.indexOf('validateSignalMessageAdded(message)') <
    controlSource.indexOf("appendSignalSourceOnlyAcceptanceStage('message-accepted')"),
  'message acceptance must only be recorded after protocol validation'
);
assert.match(controlSource, /applied\.appliedCount === 1/);
assert.match(controlSource, /appendSignalSourceOnlyAcceptanceStage\('result-applied'\)/);
assert.match(controlSource, /appendSignalSourceOnlyAcceptanceStage\('completed'\)/);

console.log('signal-transitional-status: source-only isolation, diagnostics, and composer-preservation contracts passed');
