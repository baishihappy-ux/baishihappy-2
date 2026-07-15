const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { FuseState, FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, '.runtime', 'signal-desktop');
const stagingRoot = path.join(projectRoot, '.package-staging');
const targetRoot = path.join(stagingRoot, 'signal');
const manifestPath = path.join(stagingRoot, 'signal-runtime-manifest.json');

const forbiddenRelativePaths = [
  'resources/app.before-signal-control.asar',
  'resources/app.before-signal-control.asar.unpacked',
  'resources/app.original.asar',
  'resources/app.patched.asar',
  'resources/df-runtime-binding.dat'
];

function relativePath(root, value) {
  return path.relative(root, value).split(path.sep).join('/');
}

function isForbidden(relative) {
  const normalized = relative.toLowerCase();
  return forbiddenRelativePaths.some((entry) => {
    const forbidden = entry.toLowerCase();
    return normalized === forbidden || normalized.startsWith(`${forbidden}/`);
  });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase();
}

function collectFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Signal package staging rejects symbolic links: ${target}`);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) files.push(target);
    }
  }
  return files;
}

async function main() {
  const signalExe = path.join(sourceRoot, 'Signal.exe');
  const signalAsar = path.join(sourceRoot, 'resources', 'app.asar');
  if (!fs.statSync(signalExe, { throwIfNoEntry: false })?.isFile()) throw new Error(`Signal.exe is missing: ${signalExe}`);
  if (!fs.statSync(signalAsar, { throwIfNoEntry: false })?.isFile()) throw new Error(`Signal app.asar is missing: ${signalAsar}`);

  const entries = await asar.listPackage(signalAsar);
  const bridgeEntry = entries.find((entry) => /(?:^|[\\/])bundles[\\/]chunks[\\/]messageBridge\.main-[^\\/]+\.js$/.test(entry));
  const signalMain = Buffer.from(await asar.extractFile(signalAsar, 'bundles/main.js')).toString('utf8');
  const signalBridge = bridgeEntry
    ? Buffer.from(await asar.extractFile(signalAsar, bridgeEntry.replace(/^[/\\]/, ''))).toString('utf8')
    : signalMain;
  if (!signalBridge.includes('maoyi-signal-control-auth-v1')) throw new Error('Signal runtime is missing the authenticated control protocol.');
  if (!signalMain.includes('dfLaunchPipe') || !signalMain.includes('local-direct-blocked') || !signalMain.includes('credential-accepted')) {
    throw new Error('Signal runtime is missing the launcher credential guard.');
  }

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.cpSync(sourceRoot, targetRoot, {
    recursive: true,
    filter(source) {
      const relative = relativePath(sourceRoot, source);
      return !relative || !isForbidden(relative);
    }
  });

  const files = collectFiles(targetRoot);
  const forbidden = files
    .map((file) => relativePath(targetRoot, file))
    .filter(isForbidden);
  if (forbidden.length) throw new Error(`Forbidden Signal package files survived staging: ${forbidden.join(', ')}`);

  const stagedExe = path.join(targetRoot, 'Signal.exe');
  const stagedAsar = path.join(targetRoot, 'resources', 'app.asar');
  if (!fs.statSync(stagedExe, { throwIfNoEntry: false })?.isFile()) throw new Error('Staged Signal.exe is missing.');
  if (!fs.statSync(stagedAsar, { throwIfNoEntry: false })?.isFile()) throw new Error('Staged Signal app.asar is missing.');

  // Signal Desktop 8.18 loads its preload bridge from file://. Disabling this
  // compatibility fuse makes wrapper.js fail before the renderer can start and
  // produces a permanently white Signal window. Keep the source-built Signal
  // fuse profile intact; Maoyi's own executables use a separate hardened
  // profile in electron-builder-after-pack.cjs.
  const signalFuseWire = await getCurrentFuseWire(stagedExe);
  if (signalFuseWire[FuseV1Options.GrantFileProtocolExtraPrivileges] !== FuseState.ENABLE) {
    throw new Error('Staged Signal.exe is missing the file-protocol privileges required by its preload bridge.');
  }

  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    source: '.runtime/signal-desktop',
    target: '.package-staging/signal',
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + fs.statSync(file).size, 0),
    signalExeSha256: sha256(stagedExe),
    signalAsarSha256: sha256(stagedAsar),
    excluded: forbiddenRelativePaths
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`stagedSignal=${targetRoot}`);
  console.log(`stagedFiles=${manifest.fileCount}`);
  console.log(`manifest=${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
