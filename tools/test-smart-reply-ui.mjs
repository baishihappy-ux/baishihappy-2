import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = fs.readFileSync(path.join(root, 'src', 'smart-reply-runtime.ts'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src', 'App.vue'), 'utf8');

assert.match(runtime, /platform === 'signal'\) return false/);
assert.match(runtime, /exactDirection/);
assert.match(runtime, /dataId\.startsWith\('true_'\)/);
assert.match(runtime, /dataId\.startsWith\('false_'\)/);
assert.doesNotMatch(runtime, /innerWidth\s*\/\s*2/);
assert.match(runtime, /isNearConversationEnd\(latest\.bubble\)/);
assert.match(runtime, /latest\.direction !== 'incoming'/);
assert.match(runtime, /\.slice\(-8\)/);
assert.match(runtime, /liveContext\.at\(-1\)\?\.speaker !== 'other'/);
assert.match(runtime, /action: 'smart-reply-request'/);
assert.match(runtime, /action: 'smart-reply-select'/);
assert.match(runtime, /normalizeConversationSignature/);
assert.match(runtime, /replace\(\/\\\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, 360\)/);
assert.match(runtime, /english\.textContent/);
assert.match(runtime, /chinese\.textContent/);
assert.doesNotMatch(runtime, /innerHTML\s*=\s*String\(reply/);

assert.match(app, /window\.chatTranslator\.generateSmartReplies/);
assert.match(app, /messages\.at\(-1\)\?\.speaker !== 'other'/);
assert.match(app, /result\.replies\.find\(\(item\) => item\.id === id && item\.english === english\)/);
assert.match(app, /writeNativeComposer\(profileId, approved\.english, \{ instant: true \}\)/);
const selectionBranch = app.slice(app.indexOf("if (action === 'smart-reply-select')"), app.indexOf("if (action === 'bubble-refresh')"));
assert.doesNotMatch(selectionBranch, /sendNativeComposer|queueSend|dispatchEvent\([^)]*Enter/);
assert.match(app, /buildSmartReplyUiInstallScript\(appForPlatform\(profile\.platform\)\)/);
assert.match(app, /\.df-smart-reply-host, \.df-smart-reply-panel/);

console.log('smart-reply-ui: exact-direction eligibility, 8-message context, bilingual safe rendering, and fill-only selection contracts passed');
