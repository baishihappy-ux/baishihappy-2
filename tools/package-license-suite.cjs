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
const packageStagingRoot = path.join(projectRoot, '.package-staging');

function localStamp(date) {
  return `${date.getMonth() + 1}_${date.getDate()}_${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`;
}

function targetDirectory() {
  fs.mkdirSync(suitesRoot, { recursive: true });
  const requested = String(process.env.MAOYI_SUITE_SEQUENCE || '').trim();
  if (!/^\d{3}$/.test(requested) || requested === '000') {
    throw new Error('MAOYI_SUITE_SEQUENCE must be an explicit three-digit sequence such as 006.');
  }
  const existing = fs.readdirSync(suitesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`taozhuang${requested}_`));
  if (existing.length > 1) throw new Error(`Suite sequence ${requested} has multiple directories and cannot be resumed safely.`);
  if (existing.length === 1) {
    const directory = path.join(suitesRoot, existing[0].name);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'suite-manifest.json'), 'utf8'));
    const suitePath = path.join(secretsRoot, 'license-suites', `${manifest.suiteId}.json`);
    const explicitlyRepairing = process.env.MAOYI_REPAIR_SUITE === '1';
    const resumableStatus = manifest.status === 'failed' || (manifest.status === 'complete' && explicitlyRepairing);
    if (!resumableStatus || !/^\d{9}$/.test(manifest.suiteId) || !fs.statSync(suitePath, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Suite sequence ${requested} is already present and cannot be reused.`);
    }
    return { directory, previousManifest: manifest, sequence: requested };
  }
  return {
    directory: path.join(suitesRoot, `taozhuang${requested}_${localStamp(new Date())}`),
    previousManifest: null,
    sequence: requested
  };
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
  fs.writeFileSync(issuerKeyPath, `${JSON.stringify({
    key: key.toString('base64'),
    suiteId: suite.suiteId,
    keyId: suite.keyId,
    publicKeySha256: suite.publicKeySha256
  })}\n`, { encoding: 'utf8', mode: 0o600 });
}

function copySingleExe(fromDirectory, targetFile, namePattern) {
  const matches = fs.readdirSync(fromDirectory)
    .filter((name) => namePattern.test(name) && name.toLowerCase().endsWith('.exe'));
  if (matches.length !== 1) throw new Error(`Expected one matching EXE in ${fromDirectory}, found ${matches.length}.`);
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.copyFileSync(path.join(fromDirectory, matches[0]), targetFile);
}

function main() {
  const target = targetDirectory();
  const { directory, previousManifest, sequence } = target;
  if (!previousManifest) fs.mkdirSync(directory, { recursive: false });
  const buildRoot = path.join(projectRoot, '.tmp', path.basename(directory));
  const clientBuild = path.join(buildRoot, 'client');
  const issuerBuild = path.join(buildRoot, 'issuer');
  const promptGeneratorBuild = path.join(buildRoot, 'prompt-generator');
  const manifest = {
    version: 1,
    status: 'initializing',
    directory: path.basename(directory),
    createdAt: previousManifest?.createdAt || new Date().toISOString(),
    resumedAt: previousManifest ? new Date().toISOString() : undefined,
    attempts: previousManifest ? (previousManifest.attempts || 1) + 1 : 1,
    suiteId: previousManifest?.suiteId || '',
    keyId: previousManifest?.keyId || '',
    publicKeySha256: previousManifest?.publicKeySha256 || '',
    files: []
  };
  writeManifest(directory, manifest);

  try {
    let suiteId = manifest.suiteId;
    if (!suiteId) {
      const suiteOutput = run(process.execPath, ['tools/create-license-suite.cjs'], {
        MAOYI_SUITE_OUTPUT_DIR: directory
      });
      suiteId = /suiteId=(\d{9})/.exec(suiteOutput)?.[1] || '';
      if (!suiteId) throw new Error('Suite generator did not return a suite ID.');
    } else {
      console.log(`suiteId=${suiteId}`);
      console.log('status=resuming-consumed-suite');
    }
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
    run(process.execPath, ['tools/prepare-package-signal-runtime.cjs']);
    run(process.execPath, ['tools/test-signal-control-channel.cjs'], {
      MAOYI_SIGNAL_RUNTIME_DIR: path.join(packageStagingRoot, 'signal')
    });
    sealIssuerSuite(suite);

    const builder = path.join(projectRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    run(process.execPath, [builder, '--win', 'nsis', '--config', 'electron-builder.client-suite.cjs'], {
      MAOYI_CLIENT_BUILD_OUTPUT: clientBuild
    });
    run(process.execPath, [builder, '--win', 'portable', '--config', 'electron-builder.issuer-suite.cjs'], {
      MAOYI_ISSUER_BUILD_OUTPUT: issuerBuild
    });
    run(process.execPath, [builder, '--win', 'portable', '--config', 'electron-builder.prompt-generator.cjs'], {
      MAOYI_PROMPT_GENERATOR_OUTPUT: promptGeneratorBuild
    });
    run(process.execPath, [
      'tools/verify-packaged-output.cjs',
      `--client=${clientBuild}`,
      `--issuer=${issuerBuild}`,
      `--prompt-generator=${promptGeneratorBuild}`,
      `--suite-id=${suiteId}`
    ]);

    const clientTarget = path.join(directory, '\u5ba2\u6237\u5b89\u88c5\u5305', 'maoyi \u5b89\u88c5\u5305.exe');
    const issuerTarget = path.join(directory, '\u5185\u90e8\u5de5\u5177', '\u6388\u6743\u7a0b\u5e8f.exe');
    const promptGeneratorTarget = path.join(directory, '\u5185\u90e8\u5de5\u5177', '\u63d0\u793a\u8bcd\u6587\u4ef6\u751f\u6210\u5668.exe');
    copySingleExe(clientBuild, clientTarget, /Setup/i);
    copySingleExe(issuerBuild, issuerTarget, /AUTHORIZER/i);
    copySingleExe(promptGeneratorBuild, promptGeneratorTarget, /PROMPT-GENERATOR/i);

    const readmeZh = `# maoyi \u5957\u88c5 ${sequence}\n\n- \u5957\u88c5 ID\uff1a${suiteId}\n- \u5ba2\u6237\u5b89\u88c5\u5305\uff1a\u5ba2\u6237\u5b89\u88c5\u5305/maoyi \u5b89\u88c5\u5305.exe\n- \u6388\u6743\u7a0b\u5e8f\uff1a\u5185\u90e8\u5de5\u5177/\u6388\u6743\u7a0b\u5e8f.exe\n- \u63d0\u793a\u8bcd\u751f\u6210\u5668\uff1a\u5185\u90e8\u5de5\u5177/\u63d0\u793a\u8bcd\u6587\u4ef6\u751f\u6210\u5668.exe\n- \u672c\u5957\u6388\u6743\u7a0b\u5e8f\u4ec5\u53ef\u4e3a\u672c\u5957\u5ba2\u6237\u7aef\u7b7e\u53d1\u6388\u6743\u3002\n- \u63d0\u793a\u8bcd\u751f\u6210\u5668\u662f\u5185\u90e8\u5de5\u5177\uff0c\u4e0d\u8981\u4ea4\u4ed8\u7ed9\u5ba2\u6237\u3002\n`;
    const readmeEn = `# maoyi Suite ${sequence}\n\n- Suite ID: ${suiteId}\n- Client: \u5ba2\u6237\u5b89\u88c5\u5305/maoyi \u5b89\u88c5\u5305.exe\n- Issuer: \u5185\u90e8\u5de5\u5177/\u6388\u6743\u7a0b\u5e8f.exe\n- Prompt generator: \u5185\u90e8\u5de5\u5177/\u63d0\u793a\u8bcd\u6587\u4ef6\u751f\u6210\u5668.exe\n- This issuer can authorize only the client bundled in this suite.\n- The prompt generator is an internal tool and must not be delivered to customers.\n`;
    fs.writeFileSync(path.join(directory, 'README.md'), readmeZh, 'utf8');
    fs.writeFileSync(path.join(directory, 'README.en.md'), readmeEn, 'utf8');

    manifest.status = 'complete';
    manifest.completedAt = new Date().toISOString();
    manifest.files = [clientTarget, issuerTarget, promptGeneratorTarget, path.join(directory, 'README.md'), path.join(directory, 'README.en.md')]
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
    fs.rmSync(packageStagingRoot, { recursive: true, force: true });
    fs.rmSync(buildRoot, { recursive: true, force: true });
  }
}

main();
