const { mkdirSync, readFileSync, writeFileSync } = require('fs');
const { dirname, join } = require('path');

const root = join(__dirname, '..');
const sourcePath = process.env.MAOYI_LICENSE_SUITE_PATH || join(root, '.package-secrets', 'current-license-suite.json');
const outputPath = join(root, '.package-secrets', 'client-license-suite.json');

const suite = JSON.parse(readFileSync(sourcePath, 'utf8'));
const publicSuite = {
  suiteId: String(suite.suiteId || ''),
  issuerId: String(suite.issuerId || ''),
  productId: String(suite.productId || ''),
  keyId: String(suite.keyId || ''),
  publicKeyPem: String(suite.publicKeyPem || '')
};

for (const [key, value] of Object.entries(publicSuite)) {
  if (!value) throw new Error(`Missing client license suite field: ${key}`);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(publicSuite, null, 2)}\n`, 'utf8');
console.log(`clientSuite=${publicSuite.suiteId}`);
console.log(`clientKey=${publicSuite.keyId}`);
console.log(`output=${outputPath}`);
