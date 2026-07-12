const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const asar = require('@electron/asar');

async function main() {
  const sourceFile = process.argv[2];
  const outputFile = process.argv[3];
  if (!sourceFile || !outputFile) {
    throw new Error('Usage: node tools/binary-patch-signal-asar.cjs <source-asar> <output-asar>');
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

  const picklePath = path.join(process.cwd(), 'node_modules', '@electron', 'asar', 'lib', 'pickle.js');
  const { Pickle } = await import(pathToFileURL(picklePath).href);
  const rawHeader = asar.getRawHeader(outputFile);
  const mainEntry = rawHeader.header.files.bundles.files['main.js'];
  const mainOffset = 8 + rawHeader.headerSize + Number(mainEntry.offset);
  const mainBytes = data.subarray(mainOffset, mainOffset + mainEntry.size);
  const hash = crypto.createHash('sha256').update(mainBytes).digest('hex');
  mainEntry.integrity.hash = hash;
  mainEntry.integrity.blocks = [hash];

  const headerPickle = Pickle.createEmpty();
  headerPickle.writeString(JSON.stringify(rawHeader.header));
  const headerBuf = headerPickle.toBuffer();
  if (headerBuf.length !== rawHeader.headerSize) {
    throw new Error(`Header size changed: ${rawHeader.headerSize} -> ${headerBuf.length}`);
  }

  const sizePickle = Pickle.createEmpty();
  sizePickle.writeUInt32(headerBuf.length);
  const sizeBuf = sizePickle.toBuffer();
  if (sizeBuf.length !== 8) {
    throw new Error(`Unexpected size pickle length: ${sizeBuf.length}`);
  }

  const fd = fs.openSync(outputFile, 'r+');
  try {
    fs.writeSync(fd, sizeBuf, 0, sizeBuf.length, 0);
    fs.writeSync(fd, headerBuf, 0, headerBuf.length, 8);
  } finally {
    fs.closeSync(fd);
  }

  console.log(`Patched ${outputFile} at offset ${index}; updated main.js hash ${hash}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
