const { mkdirSync, readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const { createHash, generateKeyPairSync, randomBytes, randomInt } = require('crypto');

const secretsDir = join(__dirname, '..', '.package-secrets');
const registryPath = join(secretsDir, 'suite-id-registry.json');
const suitesDir = join(secretsDir, 'license-suites');
const currentSuitePath = join(secretsDir, 'current-license-suite.json');
const poolSize = 10000;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function createSuiteIdPool() {
  const ids = new Set();
  while (ids.size < poolSize) {
    const id = String(randomInt(100000000, 1000000000));
    ids.add(id);
  }
  return [...ids].map((suiteId) => ({ suiteId, status: 'unused', createdAt: nowIso() }));
}

function loadRegistry() {
  mkdirSync(secretsDir, { recursive: true });
  mkdirSync(suitesDir, { recursive: true });
  if (!existsSync(registryPath)) {
    const registry = { version: 1, createdAt: nowIso(), ids: createSuiteIdPool() };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
    return registry;
  }
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}

function saveRegistry(registry) {
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

function assertRegistryIntegrity(registry) {
  const seen = new Set();
  for (const item of registry.ids) {
    if (!/^\d{9}$/.test(item.suiteId)) throw new Error(`Invalid suite ID: ${item.suiteId}`);
    if (seen.has(item.suiteId)) throw new Error(`Duplicate suite ID: ${item.suiteId}`);
    seen.add(item.suiteId);
  }
  if (registry.ids.length !== poolSize) throw new Error(`Suite ID pool must contain ${poolSize} entries.`);
  const publicFingerprints = new Set();
  const privateFingerprints = new Set();
  for (const item of registry.ids) {
    if (!item.publicKeySha256) continue;
    if (publicFingerprints.has(item.publicKeySha256)) throw new Error(`Duplicate public key fingerprint: ${item.publicKeySha256}`);
    publicFingerprints.add(item.publicKeySha256);
    if (privateFingerprints.has(item.privateKeySha256)) throw new Error(`Duplicate private key fingerprint: ${item.privateKeySha256}`);
    privateFingerprints.add(item.privateKeySha256);
  }
}

function generateSuite(suiteId) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return {
    suiteId,
    issuerId: 'maoyi-offline-issuer',
    productId: 'maoyi',
    keyId: `k_${suiteId}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
    publicKeyPem,
    privateKeyPem,
    publicKeySha256: sha256Hex(publicKeyPem),
    privateKeySha256: sha256Hex(privateKeyPem),
    createdAt: nowIso()
  };
}

function main() {
  const registry = loadRegistry();
  assertRegistryIntegrity(registry);
  const item = registry.ids.find((entry) => entry.status === 'unused');
  if (!item) throw new Error('No unused suite IDs remain.');

  item.status = 'consumed';
  item.consumedAt = nowIso();
  item.outputDirectory = process.env.MAOYI_SUITE_OUTPUT_DIR || '';
  saveRegistry(registry);

  let suite;
  try {
    suite = generateSuite(item.suiteId);
  } catch (error) {
    item.generationStatus = 'failed';
    item.generationError = String(error?.message || error);
    saveRegistry(registry);
    throw error;
  }
  Object.assign(item, {
    generationStatus: 'generated',
    keyId: suite.keyId,
    publicKeySha256: suite.publicKeySha256,
    privateKeySha256: suite.privateKeySha256,
    suiteConfigPath: `license-suites/${suite.suiteId}.json`
  });

  assertRegistryIntegrity(registry);
  const suitePath = join(suitesDir, `${suite.suiteId}.json`);
  if (existsSync(suitePath)) throw new Error(`Suite config already exists: ${suitePath}`);
  writeFileSync(suitePath, JSON.stringify(suite, null, 2) + '\n', 'utf8');
  writeFileSync(currentSuitePath, JSON.stringify(suite, null, 2) + '\n', 'utf8');
  saveRegistry(registry);

  console.log(`suiteId=${suite.suiteId}`);
  console.log(`keyId=${suite.keyId}`);
  console.log(`publicKeySha256=${suite.publicKeySha256}`);
  console.log(`suiteConfig=${suitePath}`);
  console.log(`currentSuiteConfig=${currentSuitePath}`);
  console.log('status=consumed');
}

main();
