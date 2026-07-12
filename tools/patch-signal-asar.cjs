const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
if (!root) {
  throw new Error('Usage: node tools/patch-signal-asar.cjs <extracted-asar-root>');
}

const mainPath = path.join(root, 'bundles', 'main.js');
let source = fs.readFileSync(mainPath, 'utf8');

const singleInstanceSnippet =
  'function bb(){Z&&(Z.isVisible()?x_(Z):Z.show())}X.info(`making app single instance`),f.app.requestSingleInstanceLock()?';
const patchedSingleInstanceSnippet =
  'function bb(){Z&&(Z.isVisible()?x_(Z):Z.show())}X.info(`making app single instance`),(f.app.requestSingleInstanceLock()||process.argv.some(e=>e===`--df-multi-instance`||e.startsWith(`--appId=`)))?';

if (!source.includes(singleInstanceSnippet) && !source.includes('--df-multi-instance')) {
  throw new Error('Signal single-instance snippet was not found.');
}

if (!source.includes('--df-multi-instance')) {
  source = source.replace(singleInstanceSnippet, patchedSingleInstanceSnippet);
}

fs.writeFileSync(mainPath, source);
console.log(`Signal main.js patched: ${source.includes('--df-multi-instance')}`);
