import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(path.join(projectRoot, 'electron', 'main.ts'), 'utf8');
const renderer = readFileSync(path.join(projectRoot, 'src', 'App.vue'), 'utf8');

assert.doesNotMatch(main, /mainWindow\.on\('blur'/, 'external focus changes must not hide Signal');
assert.doesNotMatch(main, /appGroupBlur|focusedSignalProfileId/, 'focus-group hiding state must stay removed');
assert.doesNotMatch(
  main,
  /trustedHandle\('window:minimize'[\s\S]*?hideAllSignalWindows\(\)[\s\S]*?targetWindow\?\.minimize\(\)/,
  'the invoke path must not hide Signal before minimizing the main window'
);
assert.doesNotMatch(
  main,
  /if \(action === 'minimize'\) \{\s*hideAllSignalWindows\(\)/,
  'the window-control path must not hide Signal before minimizing the main window'
);
assert.doesNotMatch(
  main,
  /mainWindow\.on\('minimize', \(\) => \{\s*hideAllSignalWindows\(\);\s*\}\);/,
  'Windows owner minimize/restore must not be followed by a second explicit Signal hide'
);
assert.match(
  main,
  /mainWindow\.on\('hide', \(\) => \{\s*hideAllSignalWindows\(\);\s*\}\);/,
  'Signal must still hide when the main window is explicitly hidden'
);
assert.match(
  main,
  /mainWindow\.on\('resized', requestSignalWorkspaceSyncBurst\);/,
  'Signal geometry must synchronize after the main window finishes resizing'
);
assert.doesNotMatch(
  main,
  /mainWindow\.on\('resize', resyncVisibleSignalWindows\);/,
  'Signal must not move from stale bounds during an in-progress main-window resize'
);
assert.match(
  main,
  /function requestSignalWorkspaceSyncBurst\(\) \{[\s\S]*?webContents\.send\('signal:sync-workspace'\);[\s\S]*?\n\}/,
  'restore and resize synchronization must ask the renderer for fresh workspace bounds'
);
assert.doesNotMatch(
  main,
  /function requestSignalWorkspaceSyncBurst\(\) \{[\s\S]*?resyncVisibleSignalWindows\(\)/,
  'restore synchronization must not expose Signal with stale bounds before renderer layout'
);
assert.match(
  main,
  /targetWindow\.once\('unmaximize',[\s\S]*?targetWindow\.setBounds\(compactBounds\)[\s\S]*?targetWindow\.unmaximize\(\);/,
  'compact bounds must be committed from the unmaximize transition instead of a fixed timer'
);
assert.match(renderer, /signalWorkspaceSyncTimer = setTimeout\([\s\S]*?\}, 80\);/);
assert.match(renderer, /onSignalWorkspaceSync\?\.\(\(\) => \{\s*scheduleSignalWorkspaceSyncBurst\(\);/);

console.log('signal-window-visibility-policy: focus persistence and main-first transition contracts passed');
