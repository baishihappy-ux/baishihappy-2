const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const failures = [];
const clientFiles = packageJson.build?.files || [];
const extraResources = packageJson.build?.extraResources || [];

if (fs.existsSync(path.join(projectRoot, 'main.js'))) failures.push('stale root main.js build artifact must be removed');
if (fs.existsSync(path.join(projectRoot, 'tools', 'prepare-trial-config.cjs'))) failures.push('legacy plaintext trial-config preparation tool must be removed');

for (const forbidden of ['license-issuer/**/*', 'dist-electron/**/*', 'electron/license-issuer-preload.cjs']) {
  if (clientFiles.includes(forbidden)) failures.push(`client files include forbidden broad entry: ${forbidden}`);
}

for (const resource of extraResources) {
  const from = typeof resource === 'string' ? resource : resource?.from;
  if (/trial-config|license-suite\.sealed|issuer-suite-key/i.test(String(from || ''))) {
    failures.push(`client resources include a secret-bearing entry: ${from}`);
  }
}

const allowedRuntimeDependencies = {
  '@noble/hashes': '2.2.0',
  '@scure/base': '2.2.0'
};
const runtimeDependencies = packageJson.dependencies || {};
for (const [name, version] of Object.entries(runtimeDependencies)) {
  if (allowedRuntimeDependencies[name] !== version) failures.push(`unexpected or unpinned runtime dependency: ${name}@${version}`);
}
for (const [name, version] of Object.entries(allowedRuntimeDependencies)) {
  if (runtimeDependencies[name] !== version) failures.push(`required address-validation dependency is missing: ${name}@${version}`);
}
if (packageJson.devDependencies?.electron !== '43.1.0') failures.push('Electron must be pinned to 43.1.0');
if (!packageJson.build?.afterPack) failures.push('Electron fuse afterPack hook is missing');

const sourceFiles = [
  'electron-builder.client-suite.cjs',
  'electron/preload.ts',
  'electron/preload.cjs'
];
for (const relativePath of sourceFiles) {
  const text = fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
  if (/trial-config\.json/.test(text)) failures.push(`${relativePath} still references trial-config.json`);
}

const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.ts'), 'utf8');
const sharedSource = fs.readFileSync(path.join(projectRoot, 'electron', 'shared.ts'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'src', 'App.vue'), 'utf8');
const licenseSource = fs.readFileSync(path.join(projectRoot, 'electron', 'license-core.ts'), 'utf8');
if (/enqueueEnterpriseChatAsset|flushEnterpriseChatAssetQueue/.test(mainSource)) {
  failures.push('automatic enterprise chat asset archival is still reachable');
}
if (/deepseekApiKey\s*:\s*string/.test(sharedSource)) failures.push('renderer-visible AppConfig still exposes the service secret');
if (/\ballowpopups\b/i.test(rendererSource)) failures.push('webview allowpopups is enabled');
if (/localStorage(?:\?|)\.setItem/.test(rendererSource)) {
  failures.push('renderer source writes data to plaintext localStorage');
}
if (!/df\.translationCache\.v1/.test(rendererSource) || !/localStorage\.removeItem/.test(rendererSource)) {
  failures.push('legacy plaintext translation-cache cleanup is missing');
}
if (!/app\.enableSandbox\(\)/.test(mainSource)) failures.push('client process sandbox is not enabled');
if (!/assertTrustedIpcSender/.test(mainSource)) failures.push('client IPC sender validation is missing');
if (!/licenseFormatVersion\s*=\s*2/.test(licenseSource) || !/X25519-HKDF-SHA256\+A256GCM/.test(licenseSource)) {
  failures.push('device-bound license envelope v2 is not enabled');
}
if (!clientFiles.includes('dist-electron/payment-address.js')) failures.push('payment address validation module is missing from the client package');
if (!clientFiles.includes('dist-electron/sensitive-send-authorization.js')) failures.push('sensitive send authorization module is missing from the client package');

if (failures.length) {
  console.error(failures.map((failure) => `SECURITY GATE: ${failure}`).join('\n'));
  process.exit(1);
}

console.log('Security source/package gate passed.');
