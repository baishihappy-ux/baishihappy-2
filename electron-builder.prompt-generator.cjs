const path = require('node:path');

const output = process.env.MAOYI_PROMPT_GENERATOR_OUTPUT || '.tmp/prompt-generator-release';

module.exports = {
  appId: 'com.maoyi.promptgenerator',
  productName: 'maoyi Prompt Generator',
  asar: true,
  electronDist: 'node_modules/electron/dist',
  extraMetadata: { main: 'dist-electron/prompt-generator.js' },
  directories: { output: path.resolve(output) },
  files: [
    'dist-electron/prompt-generator.js',
    'dist-electron/translation-prompt-bundle.js',
    'prompt-generator/**/*',
    'electron/prompt-generator-preload.cjs',
    'package.json'
  ],
  extraResources: [
    { from: 'config/translation-prompts.default.json', to: 'translation-prompts.source.json' }
  ],
  afterPack: './tools/electron-builder-after-pack.cjs',
  win: {
    target: 'portable',
    artifactName: 'maoyi-prompt-generator-${version}.${ext}'
  }
};
