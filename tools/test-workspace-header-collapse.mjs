import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(projectRoot, 'src', 'App.vue'), 'utf8');
const styles = fs.readFileSync(path.join(projectRoot, 'src', 'styles.css'), 'utf8');
const bitcoinGlyph = fs.readFileSync(path.join(projectRoot, 'src', 'assets', 'bitcoin-glyph-cutout.png'));

function includes(source, expected, contract) {
  assert.ok(source.includes(expected), `Workspace-header collapse contract missing: ${contract}`);
}

function matches(source, pattern, contract) {
  assert.match(source, pattern, `Workspace-header collapse contract missing: ${contract}`);
}

includes(app, "const workspaceHeaderCollapsed = ref(false);", 'restart default is expanded and session-only');
includes(app, "'workspace-header-collapsed': workspaceHeaderCollapsed", 'collapsed layout class');
includes(app, 'v-show="!workspaceHeaderCollapsed" class="runtime-header"', 'header content hidden when collapsed');
includes(app, 'class="runtime-header-toggle"', 'sidebar toggle below lock');
includes(app, '<span class="runtime-header-toggle-icon" aria-hidden="true">', 'independent static Bitcoin outer ring');
includes(app, "import bitcoinGlyphIcon from './assets/bitcoin-glyph-cutout.png';", 'directly extracted Bitcoin glyph asset');
includes(app, '<span class="runtime-header-toggle-glyph" :class="{ spinning: bitcoinGlyphBursting }" @animationend="handleBitcoinGlyphAnimationEnd">', 'inner Bitcoin glyph uses bounded animation bursts');
includes(app, '<img :src="bitcoinGlyphIcon" alt="" />', 'independent inner Bitcoin artwork');
includes(app, ':aria-expanded="!workspaceHeaderCollapsed"', 'accessible expanded state');
includes(app, "{{ workspaceHeaderCollapsed ? '折叠' : '展开' }}", 'visible label describes the current chat-window state');
assert.ok(!app.includes(':class="{ active: workspaceHeaderCollapsed }"'), 'Expand/collapse state must not change the Bitcoin button styling');
matches(
  app,
  /function toggleWorkspaceHeader\(\) \{[\s\S]*workspaceHeaderCollapsed\.value = !workspaceHeaderCollapsed\.value;[\s\S]*themeMenuOpen\.value = false;[\s\S]*preserveActiveSignalAfterChromeChange\(\);[\s\S]*\}/,
  'toggle closes theme menu and resynchronizes an active Signal window'
);
assert.ok(!/localStorage[\s\S]{0,120}workspaceHeaderCollapsed|workspaceHeaderCollapsed[\s\S]{0,120}localStorage/.test(app), 'Collapsed state must not persist across restart');

matches(styles, /\.workspace-page\.workspace-header-collapsed\s*\{\s*grid-template-rows:\s*0 auto minmax\(0, 1fr\);\s*\}/, 'the full 104px header row collapses to zero');
matches(styles, /\.workspace-header-collapsed \.runtime-header\s*\{\s*display:\s*none;/, 'no hidden header residue');
matches(styles, /\.workspace-header-collapsed \.multi-open-tabs\s*\{\s*padding-right:\s*142px;/, 'tabs reserve the floating window-control footprint');
matches(styles, /\.window-ctrl\.vertical\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?z-index:\s*9999;/, 'window controls remain floating');
matches(styles, /\.runtime-side\s*\{[\s\S]*?grid-template-rows:\s*88px 88px 88px 88px 74px 74px 74px minmax\(0, 1fr\);/, 'home, lock, remote guard, and toggle use equal-height rows');
matches(app, /class="runtime-lock-button"[\s\S]*class="runtime-guard-button"[\s\S]*class="runtime-header-toggle"/, 'remote guard stays between lock and expand/collapse');
matches(styles, /\.runtime-side \.runtime-header-toggle \.runtime-header-toggle-icon\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;[\s\S]*?font-size:\s*28px;/, 'enlarged Bitcoin toggle icon');
matches(styles, /\.runtime-side \.runtime-guard-button\s*\{[\s\S]*?transform:\s*translateY\(2px\);/, 'remote guard icon and labels move down together by 2px');
matches(styles, /\.runtime-side \.runtime-header-toggle\s*\{[\s\S]*?transform:\s*translateY\(7px\);/, 'Bitcoin icon and expand/collapse label keep their prior 5px offset and move down by 2px');
matches(styles, /\.runtime-side \.app-short\s*\{[\s\S]*?transform:\s*translateY\(2px\);/, 'all three platform shortcuts move down together by 2px');
includes(styles, '.theme-pink .runtime-side .runtime-header-toggle .runtime-header-toggle-icon', 'pink-theme Bitcoin icon');
assert.ok(!styles.includes('.runtime-header-toggle.active'), 'Only the expand/collapse label may change between states');
matches(styles, /\.runtime-header-toggle-glyph\s*\{[\s\S]*?transform:\s*rotateY\(0deg\);/, 'inner glyph returns upright when animation stops');
includes(app, 'const bitcoinGlyphWaitSequenceMs = [3000, 10000, 15000] as const;', '3/10/15-second repeating wait sequence');
matches(app, /function scheduleBitcoinGlyphBurst\(\) \{[\s\S]*?bitcoinGlyphWaitIndex = \(bitcoinGlyphWaitIndex \+ 1\) % bitcoinGlyphWaitSequenceMs\.length;[\s\S]*?bitcoinGlyphBursting\.value = true;/, 'wait sequence advances cyclically before each burst');
matches(app, /function handleBitcoinGlyphAnimationEnd\(event: AnimationEvent\) \{[\s\S]*?bitcoinGlyphBursting\.value = false;[\s\S]*?scheduleBitcoinGlyphBurst\(\);/, 'next wait begins only after a three-turn burst completes');
matches(styles, /\.runtime-header-toggle-glyph\.spinning\s*\{\s*animation:\s*runtime-bitcoin-glyph-burst 2\.67s linear 1;/, 'each burst runs once for 2.67 seconds');
matches(styles, /@keyframes runtime-bitcoin-glyph-burst\s*\{[\s\S]*?transform:\s*rotateY\(1080deg\);/, 'each burst rotates exactly three full turns');
assert.ok(!styles.includes('runtime-bitcoin-ring-spin'), 'outer ring must remain static');
assert.deepEqual([...bitcoinGlyph.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Extracted Bitcoin glyph must remain a PNG with alpha support');

console.log('workspace-header-collapse: zero-height collapse, floating controls, Bitcoin toggle, and restart default contracts passed');
