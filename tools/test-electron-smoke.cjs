const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { generateKeyPairSync } = require('node:crypto');

const projectRoot = path.resolve(__dirname, '..');
const testRoot = path.join(projectRoot, '.tmp', 'electron-smoke');
const clientData = path.join(testRoot, 'client-data');
const issuerData = path.join(testRoot, 'issuer-data');
const clientCapture = path.join(testRoot, 'client.png');
const issuerCapture = path.join(testRoot, 'issuer.png');
const publicSuitePath = path.join(testRoot, 'public-license-suite.json');

async function runElectron(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron smoke test timed out. ${stderr}`));
    }, 30_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Electron smoke process exited ${code}. ${stderr}`));
    });
  });
}

async function assertCapture(file) {
  const stat = await fs.stat(file);
  if (stat.size < 10_000) throw new Error(`Smoke screenshot is unexpectedly small: ${file}`);
}

async function main() {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  const { publicKey } = generateKeyPairSync('ed25519');
  await fs.writeFile(publicSuitePath, JSON.stringify({
    suiteId: '000000000',
    issuerId: 'maoyi-offline-issuer',
    productId: 'maoyi',
    keyId: 'smoke-test-public-key',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }, null, 2));
  await runElectron([projectRoot], {
    MAOYI_USER_DATA_DIR: clientData,
    MAOYI_LICENSE_PUBLIC_SUITE_PATH: publicSuitePath,
    MAOYI_SMOKE_CAPTURE_PATH: clientCapture,
    MAOYI_SMOKE_ENTER_RUNTIME: '1',
    MAOYI_SMOKE_WRITE_CACHE: '1',
    MAOYI_SMOKE_TEST_EXIT: '1'
  });
  await assertCapture(clientCapture);
  const cacheFiles = [];
  async function collect(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await collect(target);
      else if (entry.isFile() && entry.name.endsWith('.dfc')) cacheFiles.push(target);
    }
  }
  await collect(path.join(clientData, 'TranslationCache'));
  if (cacheFiles.length !== 1) throw new Error(`Expected one encrypted cache chunk, found ${cacheFiles.length}.`);
  const cacheText = await fs.readFile(cacheFiles[0], 'utf8');
  if (cacheText.includes('Security cache smoke source') || cacheText.includes('安全缓存测试译文')) {
    throw new Error('Runtime translation cache contains plaintext.');
  }
  await runElectron([path.join(projectRoot, 'dist-electron', 'license-issuer.js')], {
    MAOYI_ISSUER_USER_DATA_DIR: issuerData,
    MAOYI_ISSUER_SMOKE_CAPTURE_PATH: issuerCapture,
    MAOYI_SMOKE_TEST_EXIT: '1'
  });
  await assertCapture(issuerCapture);
  console.log(`clientCapture=${clientCapture}`);
  console.log(`issuerCapture=${issuerCapture}`);
  console.log('electron-smoke: client and issuer windows rendered');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
