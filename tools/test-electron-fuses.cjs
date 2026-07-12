const fs = require('node:fs/promises');
const path = require('node:path');
const {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire
} = require('@electron/fuses');
const hardenElectronPackage = require('./electron-builder-after-pack.cjs');

async function main() {
  const testRoot = path.resolve('.tmp', 'electron-fuse-test');
  const productFilename = 'maoyi';
  const targetExe = path.join(testRoot, `${productFilename}.exe`);
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  await fs.copyFile(require('electron'), targetExe);

  try {
    await hardenElectronPackage({
      appOutDir: testRoot,
      packager: { appInfo: { productFilename } }
    });
    const wire = await getCurrentFuseWire(targetExe);
    const expected = new Map([
      [FuseV1Options.RunAsNode, FuseState.DISABLE],
      [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
      [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
      [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FuseState.ENABLE],
      [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE],
      [FuseV1Options.WasmTrapHandlers, FuseState.ENABLE]
    ]);
    for (const [option, state] of expected) {
      if (wire[option] !== state) throw new Error(`Fuse ${FuseV1Options[option]} was ${wire[option]}, expected ${state}.`);
    }
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
  console.log('electron-fuses: hardened fuse profile passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
