import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const issuerSource = fs.readFileSync(path.join(projectRoot, 'electron', 'license-issuer.ts'), 'utf8');
const packageSource = fs.readFileSync(path.join(projectRoot, 'tools', 'package-license-suite.cjs'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'license-issuer', 'renderer.js'), 'utf8');

const contracts = [
  [issuerSource.includes("join(app.getPath('appData'), 'MAOYI AUTHORIZER', packagedIssuerIdentity.suiteId)"), 'packaged issuer user data is not namespaced by suite ID'],
  [issuerSource.includes('if (!isAbsolute(issuerUserDataOverride))'), 'issuer user-data override does not require an absolute path'],
  [issuerSource.includes('suite.suiteId !== packagedIssuerIdentity.suiteId'), 'vault suite ID is not bound to the packaged issuer'],
  [issuerSource.includes('suite.keyId !== packagedIssuerIdentity.keyId'), 'vault key ID is not bound to the packaged issuer'],
  [issuerSource.includes("(suite.publicKeySha256 || '').toLowerCase() !== packagedIssuerIdentity.publicKeySha256"), 'vault public-key fingerprint is not bound to the packaged issuer'],
  [packageSource.includes('suiteId: suite.suiteId'), 'issuer bootstrap metadata omits suite ID'],
  [packageSource.includes('keyId: suite.keyId'), 'issuer bootstrap metadata omits key ID'],
  [packageSource.includes('publicKeySha256: suite.publicKeySha256'), 'issuer bootstrap metadata omits public-key fingerprint'],
  [rendererSource.includes("if (!status.initialized) {\n    show(setupPanel);"), 'fresh issuer state does not open the password setup panel']
];

for (const [ok, message] of contracts) {
  if (!ok) throw new Error(message);
}

console.log('issuer-suite-isolation: fresh setup, suite-scoped state, and vault identity binding contracts passed');
