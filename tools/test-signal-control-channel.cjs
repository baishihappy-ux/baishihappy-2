const { execFileSync, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const runtimeDir = process.env.MAOYI_SIGNAL_RUNTIME_DIR
  ? path.resolve(process.env.MAOYI_SIGNAL_RUNTIME_DIR)
  : path.resolve('.runtime/signal-desktop');
const signalExe = path.join(runtimeDir, 'Signal.exe');
const testRoot = path.resolve('.tmp', `signal-control-test-${Date.now().toString(36)}`);
const dataRoot = path.join(testRoot, 'maoyi Data');
const profileId = '00000000-0000-4000-8000-000000000001';
const dataDir = path.join(dataRoot, 'SignalInstances', `Signal-${profileId}`);
const appId = `Signal-${profileId}`;

async function main() {
  const security = await import('../dist-electron/runtime-security-core.js');
  const signalStat = await fs.stat(signalExe).catch(() => null);
  if (!signalStat?.isFile()) throw new Error(`Signal runtime executable is missing: ${signalExe}`);
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const runtimeBinding = {
    schemaVersion: 1,
    productId: 'maoyi',
    suiteId: 'signal-control-test-suite',
    keyId: 'signal-control-test-key',
    installationId: crypto.randomUUID(),
    dataRootId: crypto.randomUUID(),
    machineCodeHash: crypto.createHash('sha256').update('signal-control-test-machine').digest('hex'),
    hardwareHash: hardwareDigest(),
    devicePublicKeyPem: publicKeyPem,
    createdAt: new Date().toISOString()
  };
  const signed = security.signRuntimeBindingPayload(runtimeBinding, privateKeyPem);
  await fs.writeFile(path.join(dataRoot, 'runtime-binding.dat'), `${JSON.stringify({
    schemaVersion: 1,
    productId: runtimeBinding.productId,
    suiteId: runtimeBinding.suiteId,
    keyId: runtimeBinding.keyId,
    installationId: runtimeBinding.installationId,
    dataRootId: runtimeBinding.dataRootId,
    ...signed,
    protectedPayload: 'test-only-protected-payload'
  })}\n`);
  await fs.writeFile(
    path.join(dataDir, 'df-instance-binding.dat'),
    `${JSON.stringify(security.createSignalInstanceBinding(runtimeBinding, profileId, privateKeyPem))}\n`
  );

  const messages = [];
  const controlState = { key: null, processId: 0, sendSequence: 0, receiveSequence: 0 };
  const server = createControlServer(messages, controlState);
  const port = await listenWithFallback(server, 0);
  const credentialPipe = await createCredentialPipe();
  const child = spawn(signalExe, [
    '--df',
    `--user-data-dir=${dataDir}`,
    `--appId=${appId}`,
    `--wsPort=${port}`,
    `--dfLaunchPipe=${credentialPipe.address}`,
    '--windowMode=embed',
    '--title=SignalControlTest'
  ], {
    stdio: 'ignore',
    windowsHide: false,
    env: {
      ...process.env,
      MAOYI_SIGNAL_GUARD_DIAGNOSTIC: path.join(testRoot, 'guard.json'),
      MAOYI_SIGNAL_GUARD_TEST_AUTOCLOSE: '1'
    }
  });
  if (!child.pid) throw new Error('Signal control test process did not receive a process ID.');
  const credential = security.createSignalLaunchCredential(
    runtimeBinding,
    profileId,
    child.pid,
    privateKeyPem
  );
  controlState.key = Buffer.from(credential.controlKey, 'base64url');
  controlState.processId = child.pid;
  credentialPipe.deliver(credential);

  // Source-hardened Signal keeps its window fail-closed until a real Maoyi
  // BrowserWindow owner is attached. This transport test has no owner window.
  // Receiving a MAC-verified window state proves the guarded process accepted
  // the launch credential and authenticated the bidirectional control channel.
  const success = await waitFor(
    () => messages.some(message => message.type === 'window.state'),
    60_000
  );
  if (success) {
    for (const socket of controlSockets) sendSecureFrame(socket, controlState, { type: 'shutdown' });
  }
  await waitFor(() => child.exitCode !== null, 10_000);
  if (child.exitCode === null) child.kill();
  await credentialPipe.close();
  for (const socket of controlSockets) socket.destroy();
  controlSockets.clear();
  await closeServer(server);
  await new Promise(resolve => setTimeout(resolve, 500));
  let diagnostic = null;
  try {
    diagnostic = JSON.parse(await fs.readFile(path.join(testRoot, 'guard.json'), 'utf8'));
  } catch {
    diagnostic = null;
  }
  let preloadLog = '';
  try {
    preloadLog = await fs.readFile(path.join(dataDir, 'logs', 'main.log'), 'utf8');
  } catch {
    preloadLog = '';
  }
  await fs.rm(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

  if (!success) {
    const observed = messages.map(message => message?.type).filter(Boolean).join(', ') || 'none';
    const stage = diagnostic?.stage || 'unavailable';
    throw new Error(`Signal control channel did not authenticate and report window state within 60 seconds. Observed: ${observed}; guard: ${stage}.`);
  }
  if (/Preload error/i.test(preloadLog)) {
    throw new Error(`Signal preload bridge failed for runtime ${runtimeDir}.`);
  }
  console.log('signal-control: guarded launch and authenticated transport checks passed');
}

const controlSockets = new Set();

function createControlServer(messages, state) {
  const server = http.createServer();
  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    if (typeof key !== 'string' || !request.url.includes(appId)) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const acceptKey = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ].join('\r\n'));
    controlSockets.add(socket);
    socket.once('close', () => controlSockets.delete(socket));
    socket.on('error', () => {});
    const challenge = crypto.randomBytes(32).toString('base64url');
    let authenticated = false;
    sendFrame(socket, { type: 'auth.challenge', appId, challenge });
    let buffered = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffered = Buffer.concat([buffered, chunk]);
      const parsed = readFrames(buffered);
      buffered = parsed.remaining;
      for (const frame of parsed.frames) {
        const message = JSON.parse(frame);
        if (!authenticated) {
          const expected = controlMac(state.key, ['maoyi-signal-control-auth-v1', appId, state.processId, challenge]);
          if (message.type !== 'auth.response' || message.processId !== state.processId || message.mac !== expected) {
            socket.destroy();
            return;
          }
          authenticated = true;
          continue;
        }
        const expectedSequence = state.receiveSequence + 1;
        const expected = controlMac(state.key, [
          'maoyi-signal-control-message-v1',
          'signal-to-main',
          appId,
          state.processId,
          message.sequence,
          message.payload
        ]);
        if (message.version !== 1 || message.sequence !== expectedSequence || message.mac !== expected) {
          socket.destroy();
          return;
        }
        state.receiveSequence = expectedSequence;
        messages.push(message.payload);
        if (message.payload?.type === 'ready') sendSecureFrame(socket, state, { type: 'window.show' });
      }
    });
  });
  return server;
}

function controlMac(key, values) {
  return crypto.createHmac('sha256', key).update(JSON.stringify(values)).digest('base64url');
}

function sendSecureFrame(socket, state, payload) {
  const sequence = ++state.sendSequence;
  sendFrame(socket, {
    version: 1,
    sequence,
    payload,
    mac: controlMac(state.key, [
      'maoyi-signal-control-message-v1',
      'main-to-signal',
      appId,
      state.processId,
      sequence,
      payload
    ])
  });
}

function hardwareDigest() {
  let stableGuid = '';
  try {
    const output = execFileSync('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid'
    ], { windowsHide: true, encoding: 'utf8' });
    stableGuid = output.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i)?.[1]?.trim() || '';
  } catch {}
  const fallback = [os.hostname(), os.platform(), os.arch(), os.cpus()[0]?.model || 'unknown-cpu'].join('\0');
  return crypto.createHash('sha256').update(stableGuid || fallback).digest('hex');
}

async function createCredentialPipe() {
  const address = `\\\\.\\pipe\\maoyi-signal-test-${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
  let socket;
  let credential;
  const server = net.createServer(nextSocket => {
    if (socket) {
      nextSocket.destroy();
      return;
    }
    socket = nextSocket;
    if (credential) socket.end(credential);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, resolve);
  });
  return {
    address,
    deliver(value) {
      credential = `${JSON.stringify(value)}\n`;
      if (socket) socket.end(credential);
    },
    close() {
      socket?.destroy();
      return closeServer(server);
    }
  };
}

function closeServer(server) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 2_000);
    try {
      server.close(finish);
    } catch {
      finish();
    }
  });
}

function sendFrame(socket, payload) {
  const message = Buffer.from(JSON.stringify(payload), 'utf8');
  let header;
  if (message.length < 126) {
    header = Buffer.from([0x81, message.length]);
  } else if (message.length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(message.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(message.length), 2);
  }
  socket.write(Buffer.concat([header, message]));
}

function readFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let length = secondByte & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;
    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      const decoded = Buffer.alloc(payload.length);
      for (let index = 0; index < payload.length; index += 1) {
        decoded[index] = payload[index] ^ mask[index % 4];
      }
      payload = decoded;
    }
    if (opcode === 0x1) frames.push(payload.toString('utf8'));
    offset += frameLength;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

async function waitFor(check, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return false;
}

function listenWithFallback(server, preferred) {
  return new Promise((resolve, reject) => {
    let retried = false;
    server.once('error', error => {
      if (!retried && (error.code === 'EADDRINUSE' || error.code === 'EACCES')) {
        retried = true;
        server.close(() => server.listen(0, '127.0.0.1'));
        return;
      }
      reject(error);
    });
    server.on('listening', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Test WebSocket server did not expose a port.'));
    });
    server.listen(preferred, '127.0.0.1');
  });
}

main().catch(async error => {
  console.error(error);
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  process.exitCode = 1;
});
