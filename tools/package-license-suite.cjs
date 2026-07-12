const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');
const suitesRoot = path.join(workspaceRoot, 'taozhuang');
const secretsRoot = path.join(projectRoot, '.package-secrets');
const issuerBuildSecrets = path.join(secretsRoot, 'issuer-build');
const issuerKeyPath = path.join(projectRoot, 'dist-electron', 'issuer-suite-key.json');

function localStamp(date) {
  return `${date.getMonth() + 1}_${date.getDate()}_${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`;
}

function nextDirectory() {
  fs.mkdirSync(suitesRoot, { recursive: true });
  const used = fs.readdirSync(suitesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^taozhuang(\d{3})_/.exec(entry.name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  const sequence = (used.length ? Math.max(...used) : 0) + 1;
  if (sequence > 999) throw new Error('Suite directory sequence exceeded 999.');
  return path.join(suitesRoot, `taozhuang${String(sequence).padStart(3, '0')}_${localStamp(new Date())}`);
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) throw new Error(`${path.basename(command)} ${args.join(' ')} failed with exit code ${result.status}`);
  return result.stdout || '';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeManifest(directory, manifest) {
  fs.writeFileSync(path.join(directory, 'suite-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function sealIssuerSuite(suite) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(suite), 'utf8'), cipher.final()]);
  const sealed = {
    version: 1,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
  fs.mkdirSync(issuerBuildSecrets, { recursive: true });
  fs.mkdirSync(path.dirname(issuerKeyPath), { recursive: true });
  fs.writeFileSync(path.join(issuerBuildSecrets, 'license-suite.sealed'), `${JSON.stringify(sealed)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(issuerKeyPath, `${JSON.stringify({ key: key.toString('base64') })}\n`, { encoding: 'utf8', mode: 0o600 });
}

function copySingleExe(fromDirectory, targetFile, namePattern) {
  const matches = fs.readdirSync(fromDirectory)
    .filter((name) => namePattern.test(name) && name.toLowerCase().endsWith('.exe'));
  if (matches.length !== 1) throw new Error(`Expected one matching EXE in ${fromDirectory}, found ${matches.length}.`);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.copyFileSync(path.join(fromDirectory, matches[0]), targetFile);
}

function main() {
  const directory = nextDirectory();
  fs.mkdirSync(directory, { recursive: false });
  const buildRoot = path.join(projectRoot, '.tmp', path.basename(directory));
  const clientBuild = path.join(buildRoot, 'client');
  const issuerBuild = path.join(buildRoot, 'issuer');
  const manifest = {
    version: 1,
    status: 'initializing',
    directory: path.basename(directory),
    createdAt: new Date().toISOString(),
    suiteId: '',
    keyId: '',
    publicKeySha256: '',
    files: []
  };
  writeManifest(directory, manifest);

  try {
    const suiteOutput = run(process.execPath, ['tools/create-license-suite.cjs'], {
      MAOYI_SUITE_OUTPUT_DIR: directory
    });
    const suiteId = /suiteId=(\d{9})/.exec(suiteOutput)?.[1];
    if (!suiteId) throw new Error('Suite generator did not return a suite ID.');
    const suitePath = path.join(secretsRoot, 'license-suites', `${suiteId}.json`);
    const suite = JSON.parse(fs.readFileSync(suitePath, 'utf8'));
    Object.assign(manifest, {
      status: 'building',
      suiteId,
      keyId: suite.keyId,
      publicKeySha256: suite.publicKeySha256
    });
    writeManifest(directory, manifest);

    run(process.execPath, ['tools/prepare-client-license-suite.cjs'], {
      MAOYI_LICENSE_SUITE_PATH: suitePath
    });
    run(process.execPath, ['tools/patch-signal-control-channel.cjs']);
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('npm_execpath is unavailable. Start this workflow with npm run suite:package.');
    run(process.execPath, [npmCli, 'run', 'test:security']);
    run(process.execPath, [npmCli, 'run', 'test:signal-control']);
    sealIssuerSuite(suite);

    const builder = path.join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    run(process.execPath, [builder, '--win', 'nsis', '--config', 'electron-builder.client-suite.cjs'], {
      MAOYI_CLIENT_BUILD_OUTPUT: clientBuild
    });
    run(process.execPath, [builder, '--win', 'portable', '--config', 'electron-builder.issuer-suite.cjs'], {
      MAOYI_ISSUER_BUILD_OUTPUT: issuerBuild
    });
    run(process.execPath, [
      'tools/verify-packaged-output.cjs',
      `--client=${clientBuild}`,
      `--issuer=${issuerBuild}`
    ]);

    const clientTarget = path.join(directory, 'client', 'maoyi 安装包.exe');
    const issuerTarget = path.join(directory, 'issuer', '授权程序.exe');
    copySingleExe(clientBuild, clientTarget, /Setup/i);
    copySingleExe(issuerBuild, issuerTarget, /AUTHORIZER/i);

    const readmeZh = `# maoyi 套装\n\n- 套装 ID：${suiteId}\n- 客户端：client/maoyi 安装包.exe\n- 授权程序：issuer/授权程序.exe\n- 本套授权程序仅可为本套客户端签发授权。\n`;
    const readmeEn = `# maoyi Suite\n\n- Suite ID: ${suiteId}\n- Client: client/maoyi 安装包.exe\n- Issuer: issuer/授权程序.exe\n- This issuer can authorize only the client bundled in this suite.\n`;
    fs.writeFileSync(path.join(directory, 'README.md'), readmeZh, 'utf8');
    fs.writeFileSync(path.join(directory, 'README.en.md'), readmeEn, 'utf8');

    manifest.status = 'complete';
    manifest.completedAt = new Date().toISOString();
    manifest.files = [clientTarget, issuerTarget, path.join(directory, 'README.md'), path.join(directory, 'README.en.md')]
      .map((file) => ({ path: path.relative(directory, file).replaceAll('\\', '/'), size: fs.statSync(file).size, sha256: sha256(file) }));
    writeManifest(directory, manifest);
    console.log(`suiteDirectory=${directory}`);
    console.log(`suiteId=${suiteId}`);
    console.log('status=complete');
  } catch (error) {
    manifest.status = 'failed';
    manifest.failedAt = new Date().toISOString();
    manifest.error = String(error?.message || error);
    writeManifest(directory, manifest);
    throw error;
  } finally {
    fs.rmSync(issuerKeyPath, { force: true });
    fs.rmSync(issuerBuildSecrets, { recursive: true, force: true });
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
}

main();
