const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const requested = process.argv[2] || '';
const target = path.resolve(projectRoot, requested);

if (!requested || path.dirname(target) !== projectRoot || path.basename(target).toLowerCase() !== 'release') {
  throw new Error('Package output cleanup is restricted to the project release directory.');
}

fs.rmSync(target, { recursive: true, force: true });
console.log(`cleanOutput=${target}`);
