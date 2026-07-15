const path = require('node:path');

const output = process.env.MAOYI_CLIENT_BUILD_OUTPUT;
if (!output) throw new Error('MAOYI_CLIENT_BUILD_OUTPUT is required.');

module.exports = {
  appId: 'com.maoyi.translator',
  productName: 'maoyi',
  asar: true,
  electronDist: 'node_modules/electron/dist',
  directories: { output: path.resolve(output) },
  files: [
    'dist/**/*',
    'dist-electron/main.js',
    'dist-electron/client-license.js',
    'dist-electron/license-core.js',
    'dist-electron/clone-reset.js',
    'dist-electron/runtime-security.js',
    'dist-electron/runtime-security-core.js',
    'dist-electron/translation-cache-crypto.js',
    'dist-electron/payment-address.js',
    'dist-electron/sensitive-send-authorization.js',
    'dist-electron/translation-sensitive-tokens.js',
    'dist-electron/translation-prompt-bundle.js',
    'dist-electron/translation-english-style.js',
    'dist-electron/shared.js',
    'electron/preload.cjs',
    'package.json'
  ],
  extraResources: [
    { from: '.package-secrets/client-license-suite.json', to: 'license-suite-public.json' },
    { from: '.package-secrets/translation-prompts.dfp', to: 'translation-prompts.dfp' },
    {
      from: '.package-staging/signal',
      to: 'signal'
    }
  ],
  afterPack: './tools/electron-builder-after-pack.cjs',
  win: {
    target: 'nsis',
    artifactName: 'maoyi-${version}-Setup.${ext}'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'maoyi'
  }
};
