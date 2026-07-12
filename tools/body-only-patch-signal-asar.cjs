const fs = require('node:fs');

const sourceFile = process.argv[2];
const outputFile = process.argv[3];
if (!sourceFile || !outputFile) {
  throw new Error('Usage: node tools/body-only-patch-signal-asar.cjs <source-asar> <output-asar>');
}

const from = Buffer.from('f.app.requestSingleInstanceLock()', 'utf8');
const to = Buffer.from('process.argv.includes("--df")||01', 'utf8');
if (from.length !== to.length) {
  throw new Error(`Patch length mismatch: ${from.length} !== ${to.length}`);
}

const data = fs.readFileSync(sourceFile);
const index = data.indexOf(from);
if (index < 0) {
  throw new Error('Target bytes were not found in Signal app.asar.');
}

to.copy(data, index);
fs.writeFileSync(outputFile, data);
console.log(`Body-only patched ${outputFile} at offset ${index}`);
