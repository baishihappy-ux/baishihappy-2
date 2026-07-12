const path = require('node:path');

const output = process.env.MAOYI_ISSUER_BUILD_OUTPUT;
if (!output) throw new Error('MAOYI_ISSUER_BUILD_OUTPUT is required.');

module.exports = {
  appId: 'com.maoyi.authorizer',
  productName: 'maoyi Authorizer',
  asar: true,
  electronDist: 'node_modules/electron/dist',
  extraMetadata: { main: 'dist-electron/license-issuer.js' },
  directories: { output: path.resolve(output) },
  files: [
    'dist-electron/license-issuer.js',
    'dist-electron/license-core.js',
    'dist-electron/issuer-suite-key.json',
    'license-issuer/**/*',
    'electron/license-issuer-preload.cjs',
    'package.json'
  ],
  extraResources: [
    { from: '.package-secrets/issuer-build/license-suite.sealed', to: 'license-suite.sealed' }
  ],
  afterPack: './tools/electron-builder-after-pack.cjs',
  win: {
    target: 'portable',
    artifactName: 'maoyi-authorizer-${version}.${ext}'
  }
};
