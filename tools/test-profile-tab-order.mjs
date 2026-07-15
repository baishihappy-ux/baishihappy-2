import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  defaultProfileTabOrder,
  sanitizeLastActiveProfileIds,
  sanitizeProfileTabOrder
} from '../dist-electron/shared.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const appSource = readFileSync(`${root}/src/App.vue`, 'utf8');

function profile(id, platform, group, createdAt) {
  return {
    id,
    name: id,
    group,
    platform,
    partition: `persist:chat-${id}`,
    createdAt,
    fingerprint: {}
  };
}

const profiles = [
  profile('wa-1', 'whatsapp', 'B', 20),
  profile('wa-2', 'whatsapp', 'A', 30),
  profile('wa-3', 'whatsapp', 'B', 10),
  profile('tg-1', 'telegram-k', '本组', 10),
  profile('sg-1', 'signal', '本组', 10)
];

assert.deepEqual(
  defaultProfileTabOrder(profiles),
  ['wa-3', 'wa-1', 'wa-2', 'tg-1', 'sg-1'],
  'profiles without manual order must use group then creation-time order'
);

const manualOrder = ['wa-2', 'wa-1', 'wa-3', 'tg-1', 'sg-1'];
assert.deepEqual(
  sanitizeProfileTabOrder(profiles, manualOrder),
  manualOrder,
  'a complete manual order must override default grouping'
);

assert.deepEqual(
  sanitizeProfileTabOrder(profiles, ['wa-2', 'wa-2', 'missing']),
  ['wa-2', 'wa-3', 'wa-1', 'tg-1', 'sg-1'],
  'invalid and duplicate ids must be removed while missing profiles are appended safely'
);

const profilesWithNew = [...profiles, profile('wa-new', 'whatsapp', 'B', 5)];
assert.deepEqual(
  sanitizeProfileTabOrder(profilesWithNew, manualOrder).filter((id) => id.startsWith('wa-')),
  ['wa-2', 'wa-1', 'wa-3', 'wa-new'],
  'a newly created profile must append after an established manual app order'
);

assert.deepEqual(
  sanitizeLastActiveProfileIds(
    profiles,
    { whatsapp: 'wa-1', telegram: 'wa-2', signal: 'missing' },
    'sg-1',
    manualOrder
  ),
  { whatsapp: 'wa-1', telegram: 'tg-1', signal: 'sg-1' },
  'last-active ids must stay inside their own application'
);

function sourceBetween(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `missing source block: ${start}`);
  return appSource.slice(startIndex, endIndex);
}

const persistenceBlock = sourceBetween(
  'async function persistProfileTabOrder',
  'async function persistActiveProfile'
);
assert.match(persistenceBlock, /profileTabOrder\.value =/);
assert.doesNotMatch(persistenceBlock, /profiles\.value\s*=/);

const dragBlock = sourceBetween('function handleTabDragStart', 'function reloadActiveWebview');
assert.match(dragBlock, /persistProfileTabOrder\(nextOrder\)/);
for (const forbidden of [
  'reloadActiveWebview',
  '.reload(',
  'launchSignalProfile',
  'scheduleProfileTranslationRefresh',
  'scheduleSignalWorkspaceSync',
  'profiles.value ='
]) {
  assert.ok(!dragBlock.includes(forbidden), `drag reorder must not invoke ${forbidden}`);
}

assert.match(appSource, /v-for="item in renderableProfiles"[\s\S]*?:key="item\.profile\.id"/);
assert.match(appSource, /const rememberedProfileId = lastActiveProfileIds\.value\[app\]/);
assert.match(appSource, /profileTabOrder: profileTabOrder\.value/);
assert.match(appSource, /workspaceConfigSaveQueue = workspaceConfigSaveQueue/);

console.log('profile-tab-order: default/manual order, last-active restore, and no-reload contracts passed');
