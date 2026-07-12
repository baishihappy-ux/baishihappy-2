const fs = require('node:fs/promises');
const path = require('node:path');
const asar = require('@electron/asar');

async function main() {
  const sourceDir = process.argv[2];
  const outputFile = process.argv[3];
  if (!sourceDir || !outputFile) {
    throw new Error('Usage: node tools/pack-signal-asar.cjs <source-dir> <output-file>');
  }

  await fs.rm(outputFile, { force: true });
  await fs.rm(`${outputFile}.unpacked`, { recursive: true, force: true });

  await asar.createPackageWithOptions(sourceDir, outputFile, {
    unpack: '*.node',
    unpackDir: 'build/icons/win'
  });

  console.log(`Packed ${path.resolve(outputFile)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
