const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(projectRoot, '..');
const defaultBaselineVersion = '8.18.0';
const supportedBaselines = Object.freeze({
  '8.17.0': Object.freeze({
    manifestFile: 'v8.17.0.json',
    archiveSha256: '8AC74903BE12CB6F4806CD3B218B1422CC9317560EA9E355DCB3EFAAF1CC9D96',
    patchSetSha256: '6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052'
  }),
  '8.18.0': Object.freeze({
    manifestFile: 'v8.18.0.json',
    archiveSha256: 'A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66',
    patchSetSha256: 'E25AA0F8308BF5DB04A41D3ED12E4F717884AFCC118BA639786A3AE523C7D1D6'
  })
});

function selectBaselineVersion(argv) {
  if (argv.length === 0) return defaultBaselineVersion;
  if (argv.length !== 2 || argv[0] !== '--version') {
    throw new Error('Usage: node tools/test-signal-source-artifact.cjs [--version <8.17.0|8.18.0>]');
  }
  const version = argv[1];
  if (!Object.hasOwn(supportedBaselines, version)) {
    throw new Error(`Unsupported Signal source baseline version: ${version}`);
  }
  return version;
}

function resolveChild(root, relativePath, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  assert.ok(
    relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    `${label} escapes its required root: ${resolvedPath}`
  );
  return resolvedPath;
}

const baselineVersion = selectBaselineVersion(process.argv.slice(2));
const baseline = supportedBaselines[baselineVersion];
const manifest = JSON.parse(fs.readFileSync(path.join(
  projectRoot,
  'signal-source',
  'baselines',
  baseline.manifestFile
), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.version, baselineVersion);
assert.equal(
  manifest.archive.repositoryRelativePath,
  `reference-sources/Signal-Desktop-v${baselineVersion}.zip`
);
assert.equal(manifest.archive.sha256, baseline.archiveSha256);
assert.equal(manifest.archive.extractedRoot, `Signal-Desktop-${baselineVersion}`);
assert.equal(
  manifest.referenceSource.repositoryRelativePath,
  `reference-sources/Signal-Desktop-v${baselineVersion}/Signal-Desktop-${baselineVersion}`
);
assert.equal(
  manifest.patchSeries.projectRelativePath,
  `signal-source/patches/v${baselineVersion}/series.json`
);
assert.equal(manifest.experiment.projectRelativePath, `.tmp/signal-source/v${baselineVersion}`);

const experimentBase = path.join(projectRoot, '.tmp', 'signal-source');
const experimentRoot = resolveChild(
  experimentBase,
  `v${baselineVersion}`,
  'Signal source experiment'
);
const sourceRoot = resolveChild(
  experimentRoot,
  manifest.archive.extractedRoot,
  'Prepared Signal source'
);
const releaseRoot = path.join(sourceRoot, 'release', 'win-unpacked');
const executablePath = path.join(releaseRoot, 'Signal.exe');
const appAsarPath = path.join(releaseRoot, 'resources', 'app.asar');
const ownerAddonPath = path.join(
  releaseRoot,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  '@signalapp',
  'windows-ucv',
  'build',
  'Release',
  'windows-ucv.node'
);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

for (const filePath of [executablePath, appAsarPath, ownerAddonPath]) {
  assert.ok(fs.statSync(filePath).isFile(), `missing Signal source build artifact: ${filePath}`);
}
assert.ok(fs.statSync(executablePath).size > 200 * 1024 * 1024, 'Signal.exe is unexpectedly small');
assert.ok(fs.statSync(appAsarPath).size > 20 * 1024 * 1024, 'app.asar is unexpectedly small');
assert.ok(fs.statSync(ownerAddonPath).size > 100 * 1024, 'windows-ucv.node is unexpectedly small');

const marker = JSON.parse(fs.readFileSync(path.join(experimentRoot, '.df-source-experiment.json'), 'utf8'));
assert.equal(marker.version, manifest.version);
assert.equal(marker.archiveSha256, baseline.archiveSha256);
assert.equal(marker.patchSetSha256, baseline.patchSetSha256);

const referenceSourceRoot = resolveChild(
  repositoryRoot,
  manifest.referenceSource.repositoryRelativePath,
  'Signal reference source'
);
const referencePackagePath = path.join(referenceSourceRoot, 'package.json');
assert.deepEqual(
  fs.readFileSync(path.join(sourceRoot, 'package.json')),
  fs.readFileSync(referencePackagePath),
  'the exact official package.json was not restored after the unsigned build'
);

const defaultConfig = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'config', 'default.json'), 'utf8'));
assert.equal(defaultConfig.updatesEnabled, false, 'the source experiment must keep Signal updates disabled');

const asar = require(path.join(sourceRoot, 'node_modules', '@electron', 'asar'));
const fileEntries = asar.listPackage(appAsarPath)
  .map(archivePath => ({
    archivePath,
    normalizedPath: archivePath.replaceAll('\\', '/').replace(/^\//, '')
  }));
const files = fileEntries.map(entry => entry.normalizedPath);
const windowsUcvRuntimeEntry = 'node_modules/@signalapp/windows-ucv/dist/index.js';
const bundleEntries = fileEntries.filter(({ normalizedPath }) => (
  normalizedPath === 'bundles/main.js' ||
  normalizedPath === 'bundles/signal-main.js' ||
  /^bundles\/chunks\/windowController\.main-.*\.js$/.test(normalizedPath) ||
  (baselineVersion === '8.18.0' && (
    normalizedPath === 'bundles/preload/main.js' ||
    /^bundles\/chunks\/messageBridge\.main-.*\.js$/.test(normalizedPath)
  ))
));
const bundlePaths = bundleEntries.map(entry => entry.normalizedPath);
assert.ok(bundlePaths.includes('bundles/main.js'), 'bundles/main.js is missing from app.asar');
assert.ok(bundlePaths.includes('bundles/signal-main.js'), 'bundles/signal-main.js is missing from app.asar');
assert.ok(
  bundlePaths.some(file => file.includes('windowController.main-')) ||
    (baselineVersion === '8.18.0' && bundlePaths.some(file => file.includes('messageBridge.main-'))),
  'the Maoyi window-security bundle is missing from app.asar'
);
if (baselineVersion === '8.18.0') {
  assert.ok(
    files.includes(windowsUcvRuntimeEntry),
    `${windowsUcvRuntimeEntry} is missing from app.asar`
  );
  assert.ok(
    bundlePaths.some(file => file.includes('messageBridge.main-')),
    'the Maoyi message bridge chunk is missing from app.asar'
  );
  assert.ok(
    bundlePaths.includes('bundles/preload/main.js'),
    'the Maoyi translation preload bundle is missing from app.asar'
  );
}
const bundledSource = bundleEntries
  .map(({ archivePath }) => asar.extractFile(
    appAsarPath,
    archivePath.replace(/^[\\/]+/, '')
  ).toString('utf8'))
  .join('\n');
for (const markerText of [
  'security.visibility',
  'security.visibility-applied',
  'window.owner',
  'script.execute',
  'maoyi-signal-control-message-v1',
  ...(baselineVersion === '8.18.0' ? [
    'message.added',
    'message.visibleBatch',
    'translation.cacheResultBatch',
    'module-message__maoyi-translation'
  ] : [])
]) {
  assert.ok(bundledSource.includes(markerText), `missing bundled source marker: ${markerText}`);
}

const ownerAddon = fs.readFileSync(ownerAddonPath).toString('latin1');
for (const markerText of [
  'setWindowOwner',
  'Window ownership validation failed',
  'Windows rejected the owner relationship'
]) {
  assert.ok(ownerAddon.includes(markerText), `missing native owner marker: ${markerText}`);
}

console.log(JSON.stringify({
  baseline: manifest.version,
  patchSetSha256: marker.patchSetSha256,
  executable: {
    path: executablePath,
    bytes: fs.statSync(executablePath).size,
    sha256: sha256(executablePath)
  },
  appAsar: {
    bytes: fs.statSync(appAsarPath).size,
    sha256: sha256(appAsarPath),
    fileCount: files.length,
    verifiedBundles: bundlePaths,
    windowsUcvRuntimeEntry: baselineVersion === '8.18.0'
      ? windowsUcvRuntimeEntry
      : undefined
  },
  ownerAddon: {
    bytes: fs.statSync(ownerAddonPath).size,
    sha256: sha256(ownerAddonPath)
  }
}, null, 2));
