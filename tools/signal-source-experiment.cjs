const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const defaultBaselineVersion = '8.17.0';
const supportedBaselines = Object.freeze({
  '8.17.0': Object.freeze({
    manifestFile: 'v8.17.0.json',
    archiveSha256: '8AC74903BE12CB6F4806CD3B218B1422CC9317560EA9E355DCB3EFAAF1CC9D96',
    patchSetSha256: '6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052'
  }),
  '8.18.0': Object.freeze({
    manifestFile: 'v8.18.0.json',
    archiveSha256: 'A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66',
    patchSetSha256: 'BF482ACA5FEB79AFD4B0C418E56DF41BEA3C38F284EF8FBDB64C1BF17F5D2650'
  })
});

function fail(message) {
  throw new Error(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveWithin(root, relativePath, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} escapes its allowed root: ${resolved}`);
  }
  return resolved;
}

function assertWithin(root, target, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${label} is outside the isolated experiment directory: ${resolvedTarget}`);
  }
}

function parseCommandLine(argv) {
  if (argv.length === 0) {
    return { action: undefined, version: defaultBaselineVersion };
  }
  const [action, option, value, ...extra] = argv;
  if (extra.length > 0 || (argv.length !== 1 && argv.length !== 3)) {
    fail('Expected one action followed by an optional --version <version>');
  }
  const version = argv.length === 1
    ? defaultBaselineVersion
    : option === '--version'
      ? value
      : '';
  if (!Object.hasOwn(supportedBaselines, version)) {
    fail(`Unsupported Signal source baseline version: ${version || value || option || 'missing'}`);
  }
  return { action, version };
}

function loadManifest(version) {
  const baseline = supportedBaselines[version];
  const manifestPath = path.join(
    projectRoot,
    'signal-source',
    'baselines',
    baseline.manifestFile
  );
  const manifest = readJson(manifestPath);
  if (manifest.schemaVersion !== 1 || manifest.version !== version) {
    fail('Unsupported Signal source baseline manifest');
  }
  if (
    manifest.archive?.repositoryRelativePath !== `reference-sources/Signal-Desktop-v${version}.zip` ||
    manifest.archive?.sha256 !== baseline.archiveSha256 ||
    manifest.archive?.extractedRoot !== `Signal-Desktop-${version}` ||
    manifest.referenceSource?.repositoryRelativePath !==
      `reference-sources/Signal-Desktop-v${version}/Signal-Desktop-${version}` ||
    manifest.patchSeries?.projectRelativePath !== `signal-source/patches/v${version}/series.json` ||
    manifest.experiment?.projectRelativePath !== `.tmp/signal-source/v${version}` ||
    manifest.package?.version !== version
  ) {
    fail('Signal source baseline manifest redirects a version-scoped path');
  }
  const expectedInstallArgs = ['pnpm', 'install', '--offline', '--frozen-lockfile'];
  if (
    !Array.isArray(manifest.build?.installArgs) ||
    manifest.build.installArgs.length !== expectedInstallArgs.length ||
    manifest.build.installArgs.some((value, index) => value !== expectedInstallArgs[index])
  ) {
    fail('Signal source dependency installation must be frozen and offline');
  }
  return Object.freeze({
    ...manifest,
    expectedPatchSetSha256: baseline.patchSetSha256
  });
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex').toUpperCase();
}

function getPaths(manifest) {
  const archivePath = resolveWithin(
    repositoryRoot,
    manifest.archive.repositoryRelativePath,
    'Signal archive path'
  );
  const referenceSourcePath = resolveWithin(
    repositoryRoot,
    manifest.referenceSource.repositoryRelativePath,
    'Signal reference source path'
  );
  const patchSeriesPath = resolveWithin(
    projectRoot,
    manifest.patchSeries.projectRelativePath,
    'Signal patch series path'
  );
  const experimentBase = resolveWithin(projectRoot, '.tmp/signal-source', 'Experiment base');
  const experimentPath = resolveWithin(
    projectRoot,
    manifest.experiment.projectRelativePath,
    'Experiment path'
  );
  const experimentSourcePath = resolveWithin(
    experimentPath,
    manifest.archive.extractedRoot,
    'Experiment source path'
  );
  return {
    archivePath,
    referenceSourcePath,
    patchSeriesPath,
    experimentBase,
    experimentPath,
    experimentSourcePath
  };
}

function getOfflinePnpmStorePaths(manifest) {
  const packageManagerVersion = manifest.package.packageManager.split('@')[1];
  const majorVersion = packageManagerVersion?.split('.')[0];
  if (!/^\d+$/.test(majorVersion || '')) {
    fail(`Invalid pnpm version in baseline manifest: ${manifest.package.packageManager}`);
  }
  const basePath = path.join(repositoryRoot, '.pnpm-store-complete');
  return {
    basePath,
    versionPath: path.join(basePath, `v${majorVersion}`)
  };
}

function loadPatchSet(manifest, paths) {
  if (!fs.existsSync(paths.patchSeriesPath)) {
    fail(`Signal patch series is missing: ${paths.patchSeriesPath}`);
  }
  const series = readJson(paths.patchSeriesPath);
  if (series.schemaVersion !== 1 || series.baseline !== manifest.version || !Array.isArray(series.patches)) {
    fail('Signal patch series does not match the source baseline');
  }
  const seriesDirectory = path.dirname(paths.patchSeriesPath);
  const patches = series.patches.map((entry, index) => {
    if (!entry || typeof entry.file !== 'string' || typeof entry.sha256 !== 'string') {
      fail(`Signal patch series entry ${index + 1} is invalid`);
    }
    if (!/^[A-F0-9]{64}$/.test(entry.sha256)) {
      fail(`Signal patch series entry ${index + 1} has an invalid SHA-256`);
    }
    const patchPath = resolveWithin(seriesDirectory, entry.file, `Signal patch ${index + 1}`);
    if (!fs.existsSync(patchPath)) {
      fail(`Signal patch is missing: ${patchPath}`);
    }
    const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(patchPath)).digest('hex').toUpperCase();
    if (actualSha256 !== entry.sha256) {
      fail(`Signal patch SHA-256 mismatch for ${entry.file}`);
    }
    return { file: entry.file, path: patchPath, sha256: actualSha256 };
  });
  const patchSetSha256 = crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: series.schemaVersion,
    baseline: series.baseline,
    patches: patches.map(patch => ({ file: patch.file, sha256: patch.sha256 }))
  })).digest('hex').toUpperCase();
  if (patchSetSha256 !== manifest.expectedPatchSetSha256) {
    fail(
      `Signal ${manifest.version} patch set SHA-256 mismatch: ` +
      `expected ${manifest.expectedPatchSetSha256}, got ${patchSetSha256}`
    );
  }
  return { patches, patchSetSha256 };
}

function verifyPackage(sourcePath, manifest, label) {
  const packagePath = path.join(sourcePath, 'package.json');
  if (!fs.existsSync(packagePath)) {
    fail(`${label} package.json is missing: ${packagePath}`);
  }
  const packageJson = readJson(packagePath);
  const actual = {
    name: packageJson.name,
    version: packageJson.version,
    node: packageJson.engines?.node,
    packageManager: packageJson.packageManager,
    electron: packageJson.devDependencies?.electron
  };
  for (const [key, expected] of Object.entries(manifest.package)) {
    if (actual[key] !== expected) {
      fail(`${label} ${key} mismatch: expected ${expected}, got ${actual[key] ?? 'missing'}`);
    }
  }
  const nvmVersion = fs.readFileSync(path.join(sourcePath, '.nvmrc'), 'utf8').trim();
  if (nvmVersion !== manifest.package.node) {
    fail(`${label} .nvmrc mismatch: expected ${manifest.package.node}, got ${nvmVersion}`);
  }
  return actual;
}

async function verifyBaseline(manifest, paths) {
  if (!fs.existsSync(paths.archivePath)) {
    fail(`Signal source archive is missing: ${paths.archivePath}`);
  }
  const archiveHash = await sha256File(paths.archivePath);
  if (archiveHash !== manifest.archive.sha256) {
    fail(`Signal source archive SHA-256 mismatch: expected ${manifest.archive.sha256}, got ${archiveHash}`);
  }
  if (!fs.existsSync(paths.referenceSourcePath)) {
    fail(`Extracted Signal reference source is missing: ${paths.referenceSourcePath}`);
  }
  verifyPackage(paths.referenceSourcePath, manifest, 'Reference source');
  const patchSet = loadPatchSet(manifest, paths);
  return { archiveHash, patchSet };
}

function formatBytes(bytes) {
  return `${(bytes / (1024 ** 3)).toFixed(1)} GiB`;
}

function availableBytes(targetPath) {
  const existingPath = fs.existsSync(targetPath) ? targetPath : projectRoot;
  const stats = fs.statfsSync(existingPath);
  return stats.bavail * stats.bsize;
}

function requireFreeSpace(targetPath, minimumBytes, purpose) {
  const freeBytes = availableBytes(targetPath);
  if (freeBytes < minimumBytes) {
    fail(`${purpose} requires at least ${formatBytes(minimumBytes)} free; ${formatBytes(freeBytes)} is available`);
  }
  return freeBytes;
}

function run(command, args, options = {}) {
  const spawnOptions = {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: false
  };
  if (process.platform === 'win32' && command === 'corepack') {
    const safeArgs = args.map(arg => {
      if (!/^[A-Za-z0-9@._:\\/-]+$/.test(arg)) {
        fail(`Unsafe Corepack argument: ${arg}`);
      }
      return arg;
    });
    return spawnSync(process.env.ComSpec || 'cmd.exe', [
      '/d',
      '/s',
      '/c',
      ['corepack', ...safeArgs].join(' ')
    ], spawnOptions);
  }
  return spawnSync(command, args, spawnOptions);
}

function commandOutput(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.error || result.status !== 0) {
    return null;
  }
  return String(result.stdout || '').trim();
}

function findVisualStudioCpp() {
  if (process.platform !== 'win32') {
    return { ok: true, detail: 'not required on this platform' };
  }
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const candidates = [
    programFilesX86 && path.join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  ].filter(Boolean);
  const vswhere = candidates.find(candidate => fs.existsSync(candidate));
  if (vswhere) {
    const result = spawnSync(vswhere, [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath'
    ], { encoding: 'utf8', stdio: 'pipe' });
    const installationPath = String(result.stdout || '').trim();
    if (result.status === 0 && installationPath) {
      return { ok: true, detail: installationPath };
    }
  }
  const clPath = commandOutput('where.exe', ['cl.exe']);
  if (clPath) {
    return { ok: true, detail: clPath.split(/\r?\n/)[0] };
  }
  return { ok: false, detail: 'Visual Studio 2022 Desktop development with C++ was not found' };
}

function parsePythonVersion(output) {
  const match = String(output || '').match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return match.slice(1).map(Number);
}

function checkToolchain(manifest, paths, options = {}) {
  const checks = [];
  const nodeVersion = process.version.replace(/^v/, '');
  checks.push({
    name: 'Node.js',
    ok: nodeVersion === manifest.package.node,
    expected: manifest.package.node,
    actual: nodeVersion
  });

  const corepackVersion = commandOutput('corepack', ['--version']);
  checks.push({
    name: 'Corepack',
    ok: Boolean(corepackVersion),
    expected: 'available',
    actual: corepackVersion || 'not found'
  });

  const pythonOutput = commandOutput('python', ['--version']);
  const pythonVersion = parsePythonVersion(pythonOutput);
  const pythonOk = Boolean(pythonVersion) && (pythonVersion[0] > 3 || (pythonVersion[0] === 3 && pythonVersion[1] >= 6));
  checks.push({
    name: 'Python',
    ok: pythonOk,
    expected: '3.6 or newer',
    actual: pythonOutput || 'not found'
  });

  const cpp = findVisualStudioCpp();
  checks.push({
    name: 'Visual Studio C++',
    ok: cpp.ok,
    expected: 'VS 2022 Desktop development with C++',
    actual: cpp.detail
  });

  const prerequisitesReady = checks.every(check => check.ok);
  if (prerequisitesReady && options.verifyPnpm) {
    const pnpmVersion = commandOutput('corepack', ['pnpm', '--version'], {
      cwd: paths.experimentSourcePath,
      env: { ...process.env, COREPACK_ENABLE_NETWORK: '0' }
    });
    const expectedPnpm = manifest.package.packageManager.split('@')[1];
    checks.push({
      name: 'pnpm',
      ok: pnpmVersion === expectedPnpm,
      expected: expectedPnpm,
      actual: pnpmVersion || 'not available through Corepack'
    });
  }

  return checks;
}

function findRegularFileWithinDepth(rootPath, fileName, maximumDepth = 2) {
  if (!rootPath || !fs.existsSync(rootPath)) return null;
  const queue = [{ directory: path.resolve(rootPath), depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let entries = [];
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const candidate = path.join(current.directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name === fileName) return candidate;
      if (entry.isDirectory() && current.depth < maximumDepth) {
        queue.push({ directory: candidate, depth: current.depth + 1 });
      }
    }
  }
  return null;
}

async function checkOfflineWindowsBuildInputs(manifest) {
  if (
    process.platform !== 'win32' ||
    process.arch !== 'x64' ||
    manifest.build?.unsignedWindows !== true
  ) {
    return { checks: [], electronArchivePath: null };
  }

  const electronVersion = manifest.package.electron;
  const archiveFileName = `electron-v${electronVersion}-win32-x64.zip`;
  const cacheRoot = process.env.electron_config_cache ||
    process.env.ELECTRON_CACHE ||
    path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache');
  const archivePath = findRegularFileWithinDepth(cacheRoot, archiveFileName);
  const expectedArchiveSha256 = manifest.build.electronArchiveSha256;
  const archiveHash = archivePath ? await sha256File(archivePath) : '';

  const electronGypRoot = path.join(os.homedir(), '.electron-gyp', electronVersion);
  const nodeVersionHeader = path.join(electronGypRoot, 'include', 'node', 'node_version.h');
  const nodeImportLibrary = path.join(electronGypRoot, 'x64', 'node.lib');
  const headerReady = [nodeVersionHeader, nodeImportLibrary].every(filePath => {
    try {
      return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
    } catch {
      return false;
    }
  });
  let headerVersion = '';
  if (headerReady) {
    const header = fs.readFileSync(nodeVersionHeader, 'utf8');
    const part = name => header.match(new RegExp(`#define\\s+NODE_${name}_VERSION\\s+(\\d+)`))?.[1] || '';
    headerVersion = `${part('MAJOR')}.${part('MINOR')}.${part('PATCH')}`;
  }

  const archiveReady = Boolean(
    archivePath &&
    /^[A-F0-9]{64}$/.test(expectedArchiveSha256) &&
    archiveHash === expectedArchiveSha256
  );
  return {
    electronArchivePath: archiveReady ? fs.realpathSync.native(archivePath) : null,
    checks: [
    {
      name: 'Electron archive cache',
      ok: archiveReady,
      expected: `${archiveFileName} SHA-256 ${expectedArchiveSha256}`,
      actual: archivePath ? `${archivePath} SHA-256 ${archiveHash}` : `missing below ${cacheRoot}`
    },
    {
      name: 'Electron native headers',
      ok: headerReady && headerVersion === manifest.package.node,
      expected: `${electronVersion} headers for Node ${manifest.package.node}`,
      actual: headerReady ? `${electronGypRoot} (Node ${headerVersion || 'unknown'})` : `missing below ${electronGypRoot}`
    }
    ]
  };
}

function checkOfflinePnpmStore(manifest) {
  const store = getOfflinePnpmStorePaths(manifest);
  const indexPath = path.join(store.versionPath, 'index.db');
  const filesPath = path.join(store.versionPath, 'files');
  let indexReady = false;
  let filesReady = false;
  try {
    indexReady = fs.statSync(indexPath).isFile() && fs.statSync(indexPath).size > 0;
    filesReady = fs.statSync(filesPath).isDirectory();
    fs.accessSync(store.versionPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch {
    indexReady = false;
    filesReady = false;
  }
  return {
    name: 'Writable offline pnpm store',
    ok: indexReady && filesReady,
    expected: `${store.versionPath} with index.db and package files`,
    actual: indexReady && filesReady ? store.versionPath : `incomplete or not writable: ${store.versionPath}`
  };
}

function printChecks(checks) {
  for (const check of checks) {
    const marker = check.ok ? 'PASS' : 'FAIL';
    console.log(`[${marker}] ${check.name}: ${check.actual} (expected ${check.expected})`);
  }
}

function verifyPrepared(manifest, paths) {
  const markerPath = path.join(paths.experimentPath, '.df-source-experiment.json');
  if (!fs.existsSync(markerPath)) {
    fail(`Prepared experiment marker is missing: ${markerPath}`);
  }
  const marker = readJson(markerPath);
  const patchSet = loadPatchSet(manifest, paths);
  if (
    marker.version !== manifest.version ||
    marker.archiveSha256 !== manifest.archive.sha256 ||
    marker.patchSetSha256 !== patchSet.patchSetSha256
  ) {
    fail('Prepared experiment marker does not match the tracked baseline');
  }
  verifyPackage(paths.experimentSourcePath, manifest, 'Prepared source');
  return marker;
}

function applyPatchSet(sourcePath, patchSet) {
  const gitEnvironment = {
    ...process.env,
    GIT_CEILING_DIRECTORIES: path.dirname(sourcePath)
  };
  for (const patch of patchSet.patches) {
    const check = run('git', [
      '-c',
      'core.autocrlf=false',
      'apply',
      '--check',
      '--whitespace=error-all',
      '--no-index',
      patch.path
    ], { cwd: sourcePath, env: gitEnvironment });
    if (check.error || check.status !== 0) {
      const detail = String(check.stderr || check.stdout || '').trim();
      fail(`Signal patch check failed for ${patch.file}${detail ? `: ${detail}` : ''}`);
    }
    const apply = run('git', [
      '-c',
      'core.autocrlf=false',
      'apply',
      '--whitespace=error-all',
      '--no-index',
      patch.path
    ], { cwd: sourcePath, env: gitEnvironment });
    if (apply.error || apply.status !== 0) {
      const detail = String(apply.stderr || apply.stdout || '').trim();
      fail(`Signal patch apply failed for ${patch.file}${detail ? `: ${detail}` : ''}`);
    }
  }
}

function expandArchive(archivePath, destinationPath) {
  const escapeLiteral = value => value.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `Expand-Archive -LiteralPath '${escapeLiteral(archivePath)}' -DestinationPath '${escapeLiteral(destinationPath)}' -Force`
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded
  ], { encoding: 'utf8', stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) {
    fail(`Failed to expand Signal source archive (exit ${result.status ?? 'unknown'})`);
  }
}

async function prepare(manifest, paths) {
  const baseline = await verifyBaseline(manifest, paths);
  const freeBytes = requireFreeSpace(
    paths.experimentBase,
    manifest.experiment.minimumPrepareFreeBytes,
    'Signal source preparation'
  );
  if (fs.existsSync(paths.experimentPath)) {
    verifyPrepared(manifest, paths);
    console.log(`Signal source experiment is already prepared: ${paths.experimentSourcePath}`);
    return;
  }

  fs.mkdirSync(paths.experimentBase, { recursive: true });
  const stagingPath = path.join(paths.experimentBase, `.prepare-${manifest.version}-${process.pid}-${Date.now()}`);
  assertWithin(paths.experimentBase, stagingPath, 'Preparation staging path');
  fs.mkdirSync(stagingPath, { recursive: false });
  try {
    expandArchive(paths.archivePath, stagingPath);
    const stagingSourcePath = resolveWithin(
      stagingPath,
      manifest.archive.extractedRoot,
      'Staged Signal source path'
    );
    verifyPackage(stagingSourcePath, manifest, 'Staged source');
    applyPatchSet(stagingSourcePath, baseline.patchSet);
    fs.writeFileSync(path.join(stagingPath, '.df-source-experiment.json'), `${JSON.stringify({
      schemaVersion: 1,
      version: manifest.version,
      archiveSha256: baseline.archiveHash,
      patchSetSha256: baseline.patchSet.patchSetSha256,
      packageManager: manifest.package.packageManager,
      node: manifest.package.node,
      preparedAt: new Date().toISOString()
    }, null, 2)}\n`, 'utf8');
    fs.renameSync(stagingPath, paths.experimentPath);
  } catch (error) {
    assertWithin(paths.experimentBase, stagingPath, 'Failed preparation staging path');
    fs.rmSync(stagingPath, { recursive: true, force: true });
    throw error;
  }
  console.log(`Prepared Signal ${manifest.version} source at ${paths.experimentSourcePath}`);
  console.log(`Free space before preparation: ${formatBytes(freeBytes)}`);
}

async function runCheck(manifest, paths) {
  const baseline = await verifyBaseline(manifest, paths);
  console.log(`Signal ${manifest.version} baseline verified`);
  console.log(`Archive SHA-256: ${baseline.archiveHash}`);
  console.log(`Patch set SHA-256: ${baseline.patchSet.patchSetSha256} (${baseline.patchSet.patches.length} patches)`);
  console.log(`Reference source: ${paths.referenceSourcePath}`);
}

async function runPreflight(manifest, paths) {
  await verifyBaseline(manifest, paths);
  verifyPrepared(manifest, paths);
  const freeBytes = requireFreeSpace(
    paths.experimentPath,
    manifest.experiment.minimumBuildFreeBytes,
    'Signal source build'
  );
  const offlineWindowsInputs = await checkOfflineWindowsBuildInputs(manifest);
  const checks = [
    ...checkToolchain(manifest, paths, { verifyPnpm: true }),
    checkOfflinePnpmStore(manifest),
    ...offlineWindowsInputs.checks
  ];
  printChecks(checks);
  console.log(`[PASS] Free space: ${formatBytes(freeBytes)} (expected ${formatBytes(manifest.experiment.minimumBuildFreeBytes)} or more)`);
  if (checks.some(check => !check.ok)) {
    fail('Signal source build toolchain is incomplete');
  }
  console.log('Signal source build preflight passed');
  return offlineWindowsInputs;
}

function runCorepack(args, cwd, env = process.env) {
  console.log(`Running: corepack ${args.join(' ')}`);
  const offlineEnvironment = { ...env, COREPACK_ENABLE_NETWORK: '0' };
  const result = run('corepack', args, { cwd, env: offlineEnvironment, inherit: true });
  if (result.error || result.status !== 0) {
    fail(`Command failed: corepack ${args.join(' ')}`);
  }
}

function verifyReusableDependencyTree(manifest, paths, required = false) {
  if (!required && process.env.MAOYI_SIGNAL_SOURCE_REUSE_DEPENDENCIES !== '1') {
    return false;
  }
  const nodeModulesRoot = path.join(paths.experimentSourcePath, 'node_modules');
  const sourceLockPath = path.join(paths.experimentSourcePath, 'pnpm-lock.yaml');
  const installedLockPath = path.join(nodeModulesRoot, '.pnpm', 'lock.yaml');
  const modulesManifestPath = path.join(nodeModulesRoot, '.modules.yaml');
  const requiredFiles = [
    installedLockPath,
    modulesManifestPath,
    path.join(nodeModulesRoot, '.bin', 'electron-builder.cmd'),
    path.join(nodeModulesRoot, '.bin', 'prettier.cmd'),
    path.join(nodeModulesRoot, 'electron', 'dist', 'electron.exe'),
    path.join(nodeModulesRoot, 'electron', 'dist', 'version'),
    path.join(nodeModulesRoot, '@indutny', 'mac-screen-share', 'package.json'),
    path.join(nodeModulesRoot, 'typescript', 'package.json'),
    path.join(paths.experimentSourcePath, 'packages', 'windows-ucv', 'node_modules', 'bindings', 'package.json'),
    path.join(paths.experimentSourcePath, 'packages', 'windows-ucv', 'node_modules', 'node-addon-api', 'package.json'),
    path.join(paths.experimentSourcePath, 'packages', 'mute-state-change', 'node_modules', 'bindings', 'package.json'),
    path.join(paths.experimentSourcePath, 'sticker-creator', 'node_modules', 'react', 'package.json')
  ];
  for (const filePath of requiredFiles) {
    try {
      if (!fs.statSync(filePath).isFile() || fs.statSync(filePath).size <= 0) {
        fail(`Reusable Signal dependency file is invalid: ${filePath}`);
      }
    } catch {
      fail(`Reusable Signal dependency file is missing: ${filePath}`);
    }
    const canonicalFile = fs.realpathSync.native(filePath);
    const relative = path.relative(fs.realpathSync.native(nodeModulesRoot), canonicalFile);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      fail(`Reusable Signal dependency escaped node_modules: ${canonicalFile}`);
    }
  }
  if (!fs.readFileSync(sourceLockPath).equals(fs.readFileSync(installedLockPath))) {
    fail('Reusable Signal dependency lock does not match the exact source lock');
  }
  const modulesManifest = readJson(modulesManifestPath);
  const expectedVirtualStore = path.join(nodeModulesRoot, '.pnpm');
  const expectedStore = getOfflinePnpmStorePaths(manifest).versionPath;
  if (
    modulesManifest.packageManager !== manifest.package.packageManager ||
    !Array.isArray(modulesManifest.pendingBuilds) ||
    modulesManifest.pendingBuilds.length !== 0 ||
    path.resolve(modulesManifest.storeDir || '') !== path.resolve(expectedStore) ||
    path.resolve(modulesManifest.virtualStoreDir || '') !== path.resolve(expectedVirtualStore)
  ) {
    fail('Reusable Signal dependency metadata does not match the prepared source');
  }
  const electronVersion = fs.readFileSync(
    path.join(nodeModulesRoot, 'electron', 'dist', 'version'),
    'utf8'
  ).trim();
  if (electronVersion !== manifest.package.electron) {
    fail(`Reusable Electron version mismatch: expected ${manifest.package.electron}, got ${electronVersion}`);
  }
  console.log('Reusing an exact lock-matched Signal dependency tree; online installation remains disabled');
  return true;
}

function refreshWorkspaceDependencyBuildOutputs(paths, env) {
  runCorepack(
    ['pnpm', '--filter', '@signalapp/windows-ucv', 'run', 'build'],
    paths.experimentSourcePath,
    env
  );
}

function refreshReusableDependencyBuildOutputs(paths, env) {
  refreshWorkspaceDependencyBuildOutputs(paths, env);
  runCorepack(
    ['pnpm', 'run', 'build:acknowledgments'],
    paths.experimentSourcePath,
    env
  );
  runCorepack(
    ['pnpm', 'run', 'electron:install-app-deps'],
    paths.experimentSourcePath,
    env
  );
}

function cleanBuildOutputs(manifest, paths) {
  const cleanPaths = manifest.build.cleanPaths;
  if (!Array.isArray(cleanPaths) || cleanPaths.length === 0) {
    fail('Signal source build cleanPaths are missing');
  }
  for (const relativePath of cleanPaths) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      fail('Signal source build clean path is invalid');
    }
    const target = resolveWithin(paths.experimentSourcePath, relativePath, 'Signal build clean path');
    assertWithin(paths.experimentSourcePath, target, 'Signal build clean path');
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Cleaned Signal build output: ${target}`);
  }
}

function configureOfflineReleaseStep(manifest, step, electronArchivePath) {
  const isWindowsRelease = process.platform === 'win32' &&
    manifest.build.unsignedWindows === true &&
    step[0] === 'pnpm' &&
    step[1] === 'run' &&
    step[2] === 'build:release' &&
    step.includes('--win') &&
    step.includes('dir');
  if (!isWindowsRelease) return step;
  if (!electronArchivePath) {
    fail('Verified local Electron archive is required for offline Windows packaging');
  }
  if (step.some(value => value.startsWith('--publish')) ||
      step.some(value => value.startsWith('--config.electronDist'))) {
    fail('Signal release step must not override the offline packaging gate');
  }
  return [
    ...step,
    '--publish',
    'never',
    '--config.electronDist',
    electronArchivePath
  ];
}

function runBuildSteps(manifest, paths, env, options = {}) {
  const steps = manifest.build.buildSteps;
  if (!Array.isArray(steps) || steps.length === 0) {
    fail('Signal source build steps are missing');
  }
  const selectedSteps = options.releaseOnly ? [steps.at(-1)] : steps;
  for (const [index, step] of selectedSteps.entries()) {
    if (!Array.isArray(step) || step.length < 2 || step.some(value => typeof value !== 'string' || !value)) {
      fail(`Signal source build step ${index + 1} is invalid`);
    }
    const effectiveStep = configureOfflineReleaseStep(
      manifest,
      step,
      options.electronArchivePath
    );
    runCorepack(effectiveStep, paths.experimentSourcePath, env);
  }
}

function runUnsignedWindowsBuild(manifest, paths, env, options = {}) {
  if (process.platform !== 'win32' || manifest.build.unsignedWindows !== true) {
    runBuildSteps(manifest, paths, env, options);
    return;
  }
  const packagePath = path.join(paths.experimentSourcePath, 'package.json');
  const original = fs.readFileSync(packagePath, 'utf8');
  const packageJson = JSON.parse(original);
  const signing = packageJson.build?.win?.signtoolOptions;
  if (
    !signing ||
    signing.sign !== 'scripts/sign-windows.mjs' ||
    typeof signing.certificateSha1 !== 'string' ||
    typeof signing.certificateSubjectName !== 'string'
  ) {
    fail(`Signal Windows signing configuration no longer matches the reviewed v${manifest.version} baseline`);
  }
  delete signing.certificateSha1;
  delete signing.certificateSubjectName;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  console.log('Temporarily removed Signal signing identity using the official unsigned-CI convention');
  try {
    runBuildSteps(manifest, paths, env, options);
  } finally {
    fs.writeFileSync(packagePath, original, 'utf8');
    console.log(`Restored the exact Signal v${manifest.version} package.json after unsigned build`);
  }
}

async function build(manifest, paths) {
  const offlineWindowsInputs = await runPreflight(manifest, paths);
  const buildEnvironment = {
    ...process.env,
    CI: 'true',
    PNPM_CONFIG_STORE_DIR: getOfflinePnpmStorePaths(manifest).basePath
  };
  console.log('Running Signal build subprocesses with CI=true to match official non-interactive CI behavior');
  if (verifyReusableDependencyTree(manifest, paths)) {
    refreshReusableDependencyBuildOutputs(paths, buildEnvironment);
  } else {
    runCorepack(manifest.build.installArgs, paths.experimentSourcePath, buildEnvironment);
  }
  cleanBuildOutputs(manifest, paths);
  runUnsignedWindowsBuild(manifest, paths, buildEnvironment, {
    electronArchivePath: offlineWindowsInputs.electronArchivePath
  });
  console.log(`Signal ${manifest.version} source build completed`);
}

function verifyReleasePackagingInputs(manifest, paths) {
  const requiredFiles = [
    'bundles/main.js',
    'bundles/signal-main.js',
    'bundles/preload/main.js',
    'bundles/preload/wrapper.js',
    'config/local-production.json',
    'stylesheets/manifest.css',
    'packages/windows-ucv/dist/index.js'
  ];
  for (const relativePath of requiredFiles) {
    const filePath = resolveWithin(paths.experimentSourcePath, relativePath, 'Release packaging input');
    try {
      if (!fs.statSync(filePath).isFile() || fs.statSync(filePath).size <= 0) {
        fail(`Signal release packaging input is invalid: ${filePath}`);
      }
    } catch {
      fail(`Signal release packaging input is missing: ${filePath}`);
    }
  }
  if (manifest.version === '8.18.0') {
    const mainBundle = fs.readFileSync(
      path.join(paths.experimentSourcePath, 'bundles', 'main.js'),
      'utf8'
    );
    const preloadBundle = fs.readFileSync(
      path.join(paths.experimentSourcePath, 'bundles', 'preload', 'main.js'),
      'utf8'
    );
    for (const marker of [
      'translation.refresh.request',
      'translation.cacheResultBatch',
      'smartReply.request',
      'smartReply.result',
      'smartReply.error'
    ]) {
      if (!mainBundle.includes(marker) && !preloadBundle.includes(marker)) {
        fail(`Signal release packaging input is stale; missing marker: ${marker}`);
      }
    }
  }
}

async function packageRelease(manifest, paths) {
  const offlineWindowsInputs = await runPreflight(manifest, paths);
  const buildEnvironment = {
    ...process.env,
    CI: 'true',
    PNPM_CONFIG_STORE_DIR: getOfflinePnpmStorePaths(manifest).basePath
  };
  verifyReusableDependencyTree(manifest, paths, true);
  refreshWorkspaceDependencyBuildOutputs(paths, buildEnvironment);
  verifyReleasePackagingInputs(manifest, paths);
  const releasePath = resolveWithin(paths.experimentSourcePath, 'release', 'Signal release output');
  assertWithin(paths.experimentSourcePath, releasePath, 'Signal release output');
  fs.rmSync(releasePath, { recursive: true, force: true });
  console.log('Reusing verified generated Signal bundles; only final release packaging will run');
  runUnsignedWindowsBuild(manifest, paths, buildEnvironment, {
    releaseOnly: true,
    electronArchivePath: offlineWindowsInputs.electronArchivePath
  });
  console.log(`Signal ${manifest.version} release packaging completed`);
}

function printUsage() {
  console.log(
    'Usage: node tools/signal-source-experiment.cjs ' +
    '<check|prepare|verify|preflight|build|package> [--version <8.17.0|8.18.0>]'
  );
  console.log(`Default version: ${defaultBaselineVersion}`);
}

async function main() {
  const { action, version } = parseCommandLine(process.argv.slice(2));
  const manifest = loadManifest(version);
  const paths = getPaths(manifest);
  if (action === 'check') {
    await runCheck(manifest, paths);
    return;
  }
  if (action === 'prepare') {
    await prepare(manifest, paths);
    return;
  }
  if (action === 'verify') {
    await verifyBaseline(manifest, paths);
    verifyPrepared(manifest, paths);
    console.log(`Prepared Signal ${manifest.version} source verified: ${paths.experimentSourcePath}`);
    return;
  }
  if (action === 'preflight') {
    await runPreflight(manifest, paths);
    return;
  }
  if (action === 'build') {
    await build(manifest, paths);
    return;
  }
  if (action === 'package') {
    await packageRelease(manifest, paths);
    return;
  }
  printUsage();
  process.exitCode = 2;
}

main().catch(error => {
  console.error(`Signal source experiment failed: ${error.message}`);
  process.exitCode = 1;
});
