const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');
const baselineVersion = '8.18.0';
const sourceRoot = path.join(
  projectRoot,
  '.tmp',
  'signal-source',
  `v${baselineVersion}`,
  `Signal-Desktop-${baselineVersion}`,
  'release',
  'win-unpacked'
);
const targetRoot = path.join(projectRoot, '.runtime', 'signal-desktop');
const backupRoot = path.join(projectRoot, '.tmp', 'runtime-backups');
const sourceAsar = path.join(sourceRoot, 'resources', 'app.asar');
const targetAsar = path.join(targetRoot, 'resources', 'app.asar');
const runtimeBindingName = 'df-runtime-binding.dat';
const checkOnly = process.argv.includes('--check');

function assertInsideProject(candidate, label) {
  const relativePath = path.relative(projectRoot, path.resolve(candidate));
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside ${projectRoot}`);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

function requiredFile(root, relativePath) {
  const candidate = path.join(root, relativePath);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`Verified Signal v${baselineVersion} artifact is missing ${relativePath}`);
  }
  return candidate;
}

function removeVerifiedTemporaryDirectory(candidate) {
  const resolved = path.resolve(candidate);
  assertInsideProject(resolved, 'Signal runtime temporary directory');
  if (!path.basename(resolved).startsWith('signal-desktop.sync-')) {
    throw new Error(`Refusing to remove an unexpected runtime path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

assertInsideProject(sourceRoot, 'Signal source artifact');
assertInsideProject(targetRoot, 'Signal development runtime');
assertInsideProject(backupRoot, 'Signal runtime backup');
requiredFile(sourceRoot, 'Signal.exe');
requiredFile(sourceRoot, path.join('resources', 'app.asar'));

const sourceHash = sha256(sourceAsar);
const targetHash = fs.existsSync(targetAsar) ? sha256(targetAsar) : '';
if (sourceHash === targetHash) {
  console.log(`Signal developer runtime is synchronized with verified v${baselineVersion}: ${sourceHash}`);
  process.exit(0);
}

if (checkOnly) {
  throw new Error(
    `Signal developer runtime is stale. Expected ${sourceHash}, received ${targetHash || 'missing'}. Run npm run dev to synchronize it.`
  );
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const temporaryRoot = path.join(projectRoot, '.runtime', `signal-desktop.sync-${process.pid}-${Date.now()}`);
const backupPath = path.join(backupRoot, `signal-desktop-before-dev-sync-${stamp}`);
assertInsideProject(temporaryRoot, 'Signal runtime temporary directory');
assertInsideProject(backupPath, 'Signal runtime backup directory');

fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
fs.mkdirSync(backupRoot, { recursive: true });
try {
  fs.cpSync(sourceRoot, temporaryRoot, { recursive: true, errorOnExist: true, force: false });
  const currentBinding = path.join(targetRoot, 'resources', runtimeBindingName);
  if (fs.existsSync(currentBinding)) {
    fs.copyFileSync(currentBinding, path.join(temporaryRoot, 'resources', runtimeBindingName));
  }
  const temporaryHash = sha256(path.join(temporaryRoot, 'resources', 'app.asar'));
  if (temporaryHash !== sourceHash) throw new Error('Copied Signal developer runtime failed SHA-256 verification.');

  let targetMoved = false;
  try {
    if (fs.existsSync(targetRoot)) {
      fs.renameSync(targetRoot, backupPath);
      targetMoved = true;
    }
    fs.renameSync(temporaryRoot, targetRoot);
  } catch (error) {
    if (targetMoved && !fs.existsSync(targetRoot) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, targetRoot);
    }
    throw new Error(`Unable to synchronize Signal developer runtime. Close the development Signal window and retry. ${error.message}`);
  }
} catch (error) {
  if (fs.existsSync(temporaryRoot)) removeVerifiedTemporaryDirectory(temporaryRoot);
  throw error;
}

const synchronizedHash = sha256(targetAsar);
if (synchronizedHash !== sourceHash) throw new Error('Synchronized Signal developer runtime failed final SHA-256 verification.');
console.log(`Signal developer runtime synchronized with verified v${baselineVersion}: ${synchronizedHash}`);
console.log(`Previous runtime preserved at ${backupPath}`);
