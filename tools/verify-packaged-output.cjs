const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { FuseState, FuseV1Options, getCurrentFuseWire } = require('@electron/fuses');

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || '';
}

function findFile(root, fileName) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name === fileName) return target;
    }
  }
  throw new Error(`${fileName} was not found under ${root}`);
}

async function verifyFuses(executablePath) {
  const wire = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
    [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, FuseState.DISABLE]
  ]);
  for (const [option, state] of expected) {
    if (wire[option] !== state) throw new Error(`${path.basename(executablePath)} fuse ${FuseV1Options[option]} is not hardened.`);
  }
}

async function verifyClient(clientRoot) {
  const executable = findFile(clientRoot, 'maoyi.exe');
  await verifyFuses(executable);
  const appRoot = path.dirname(executable);
  const resources = path.join(appRoot, 'resources');
  const appAsar = path.join(resources, 'app.asar');
  const entries = await asar.listPackage(appAsar);
  for (const forbidden of [/license-issuer/i, /trial-config/i, /issuer-suite-key/i, /license-suite\.sealed/i]) {
    if (entries.some((entry) => forbidden.test(entry))) throw new Error(`Client app.asar contains forbidden entry matching ${forbidden}.`);
  }
  for (const forbiddenPath of [
    path.join(resources, 'trial-config.json'),
    path.join(resources, 'license-suite.sealed'),
    path.join(resources, 'issuer-suite-key.json'),
    path.join(resources, 'signal', 'resources', 'df-runtime-binding.dat')
  ]) {
    if (fs.existsSync(forbiddenPath)) throw new Error(`Client package contains forbidden resource: ${forbiddenPath}`);
  }
  const signalAsar = path.join(resources, 'signal', 'resources', 'app.asar');
  const signalMain = Buffer.from(await asar.extractFile(signalAsar, 'bundles/main.js')).toString('utf8');
  const signalGuard = Buffer.from(await asar.extractFile(signalAsar, 'df-bootstrap.cjs')).toString('utf8');
  if (!signalMain.includes('__dfSignalControlAuthV1')) throw new Error('Bundled Signal is missing authenticated control protocol.');
  if (!signalGuard.includes('credential.controlKey')) throw new Error('Bundled Signal guard is missing the control key binding.');
}

async function verifyIssuer(issuerRoot) {
  const executable = findFile(issuerRoot, 'maoyi Authorizer.exe');
  await verifyFuses(executable);
  const appAsar = path.join(path.dirname(executable), 'resources', 'app.asar');
  const entries = await asar.listPackage(appAsar);
  if (entries.some((entry) => /trial-config/i.test(entry))) throw new Error('Issuer app.asar contains trial-config data.');
}

async function main() {
  const clientRoot = path.resolve(argument('client'));
  const issuerRoot = path.resolve(argument('issuer'));
  if (!argument('client') || !argument('issuer')) throw new Error('--client and --issuer are required.');
  await verifyClient(clientRoot);
  await verifyIssuer(issuerRoot);
  console.log('packaged-output: client and issuer security checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
