import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWindowsChromiumUserAgent,
  legacyWhatsAppChrome130UserAgent,
  resolveProfileUserAgent
} from '../dist-electron/shared.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(projectRoot, 'electron', 'main.ts'), 'utf8');
const app = fs.readFileSync(path.join(projectRoot, 'src', 'App.vue'), 'utf8');
const runtimeUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

assert.equal(
  buildWindowsChromiumUserAgent('150.0.7871.47'),
  runtimeUserAgent,
  'the public browser identity must derive its reduced Chrome major from the actual Chromium runtime'
);
for (const invalidVersion of ['', '150', '150.0', '150.0.7871', 'v150.0.7871.47', '0.0.0.0']) {
  assert.throws(
    () => buildWindowsChromiumUserAgent(invalidVersion),
    /Chromium runtime version is invalid/,
    `invalid Chromium version must be rejected: ${invalidVersion || '<empty>'}`
  );
}

assert.equal(
  resolveProfileUserAgent('whatsapp', legacyWhatsAppChrome130UserAgent, runtimeUserAgent),
  runtimeUserAgent,
  'the exact obsolete WhatsApp Chrome/130 identity must migrate to the runtime-aligned identity'
);
assert.equal(
  resolveProfileUserAgent('whatsapp', undefined, runtimeUserAgent),
  runtimeUserAgent,
  'a missing WhatsApp identity must use the runtime-aligned default'
);
assert.equal(
  resolveProfileUserAgent('whatsapp', '   ', runtimeUserAgent),
  runtimeUserAgent,
  'an empty WhatsApp identity must use the runtime-aligned default'
);
const customUserAgent = legacyWhatsAppChrome130UserAgent.replace('Chrome/130.0.0.0', 'Chrome/149.0.0.0');
assert.equal(
  resolveProfileUserAgent('whatsapp', customUserAgent, runtimeUserAgent),
  customUserAgent,
  'a non-legacy custom WhatsApp identity must be preserved'
);
for (const nearLegacyUserAgent of [
  `${legacyWhatsAppChrome130UserAgent} `,
  legacyWhatsAppChrome130UserAgent.replace('Windows NT 10.0', 'Windows NT 11.0'),
  legacyWhatsAppChrome130UserAgent.replace('Safari/537.36', 'Safari/537.35')
]) {
  assert.equal(
    resolveProfileUserAgent('whatsapp', nearLegacyUserAgent, runtimeUserAgent),
    nearLegacyUserAgent,
    'only the byte-exact managed Chrome/130 identity may be migrated'
  );
}
assert.equal(
  resolveProfileUserAgent('telegram-k', legacyWhatsAppChrome130UserAgent, 'telegram-default'),
  legacyWhatsAppChrome130UserAgent,
  'the targeted migration must not rewrite another platform identity'
);
assert.equal(
  resolveProfileUserAgent('signal', legacyWhatsAppChrome130UserAgent, runtimeUserAgent),
  legacyWhatsAppChrome130UserAgent,
  'the targeted migration must not rewrite a Signal fingerprint record'
);

for (const contract of [
  'const whatsappUserAgent = buildWindowsChromiumUserAgent(process.versions.chrome)',
  'app.userAgentFallback = defaultBrowserUserAgent',
  'resolveProfileUserAgent(',
  'ses.setUserAgent(profile.fingerprint.userAgent)',
  "'User-Agent': profile.fingerprint.userAgent"
]) {
  assert.ok(main.includes(contract), `main-process browser identity contract is missing: ${contract}`);
}
assert.ok(
  app.includes(':useragent="item.profile.fingerprint.userAgent"'),
  'each WhatsApp webview must use the same migrated profile identity as its session and requests'
);
assert.doesNotMatch(
  main,
  /const whatsappUserAgent\s*=\s*['"`][^'"`]*Chrome\/130\.0\.0\.0/,
  'the active WhatsApp identity must not remain pinned to Chrome/130'
);

console.log('browser-user-agent: runtime alignment and targeted Chrome/130 migration contracts passed');
