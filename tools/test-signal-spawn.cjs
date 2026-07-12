const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const signal = path.resolve('.runtime/signal-desktop/Signal.exe');
const dataDir = path.resolve('.tmp/signal spawn spaced');
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(signal, [
  '--df',
  `--user-data-dir=${dataDir}`,
  '--appId=Signal-spawn-spaced',
  '--title=SignalSpawnSpaced',
  '--enable-logging'
], {
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => {
  stdout += chunk.toString();
});
child.stderr.on('data', chunk => {
  stderr += chunk.toString();
});

setTimeout(() => {
  console.log('PID=' + child.pid);
  console.log('STDOUT_HEAD=' + stdout.split(/\r?\n/).slice(0, 12).join('\n'));
  console.log('STDERR_HEAD=' + stderr.split(/\r?\n/).slice(0, 12).join('\n'));
  child.kill();
}, 8000);
