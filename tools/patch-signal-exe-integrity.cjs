const fs = require('node:fs');

const exeFile = process.argv[2];
const oldHash = process.argv[3];
const newHash = process.argv[4];
if (!exeFile || !oldHash || !newHash) {
  throw new Error('Usage: node tools/patch-signal-exe-integrity.cjs <exe-file> <old-hash> <new-hash>');
}
if (oldHash.length !== newHash.length) {
  throw new Error(`Hash length mismatch: ${oldHash.length} !== ${newHash.length}`);
}

const data = fs.readFileSync(exeFile);
const from = Buffer.from(oldHash, 'utf8');
const to = Buffer.from(newHash, 'utf8');
const index = data.indexOf(from);
if (index < 0) {
  throw new Error(`Old integrity hash was not found in ${exeFile}`);
}

to.copy(data, index);
fs.writeFileSync(exeFile, data);
console.log(`Patched ${exeFile} integrity hash at offset ${index}`);
