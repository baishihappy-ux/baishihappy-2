const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const testRoot = path.join(projectRoot, '.tmp', 'signal-render-cache-runtime');

function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text || '').replace(/\s+/g, ' ').trim()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function readRuntimeBuilder() {
  const source = await fs.readFile(path.join(projectRoot, 'src', 'App.vue'), 'utf8');
  const start = source.indexOf('function buildCachedTranslationRuntimeScript');
  const end = source.indexOf('\nfunction buildMessageTranslationInjectScript', start);
  if (start < 0 || end < 0) throw new Error('Signal render-cache runtime builder was not found.');
  const functionSource = source
    .slice(start, end)
    .replace(
      /^function buildCachedTranslationRuntimeScript[^\r\n]*\{/,
      'function buildCachedTranslationRuntimeScript(app, entries) {'
    );
  return new Function(
    'browserRenderCacheEntryLimit',
    `${functionSource}\nreturn buildCachedTranslationRuntimeScript;`
  )(1500);
}

async function runElectronChild() {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', path.join(testRoot, 'user-data'));
  await app.whenReady();

  const buildRuntime = await readRuntimeBuilder();
  const sourceA = 'Hello from A';
  const sourceB = 'Good evening from B';
  const translationA = 'Cached translation A';
  const translationB = 'Cached translation B';
  const hashA = hashText(sourceA);
  const hashB = hashText(sourceB);
  const runtimeScript = buildRuntime('signal', [
    { sourceHash: hashA, sourceText: sourceA, translatedText: translationA, updatedAt: Date.now() },
    { sourceHash: hashB, sourceText: sourceB, translatedText: translationB, updatedAt: Date.now() }
  ]);

  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const html = `<!doctype html><html><head><style>
    body { margin: 0; width: 900px; height: 700px; }
    #conversation { width: 700px; min-height: 500px; }
    [data-testid="message-row"] { width: 360px; min-height: 80px; }
    [dir="auto"] { display: block; width: 300px; min-height: 24px; }
  </style></head><body><main id="conversation">
    <div id="reused-row" data-testid="message-row"><div dir="auto">${sourceA}</div></div>
  </main></body></html>`;
  const fixturePath = path.join(testRoot, 'signal-render-cache.html');
  await fs.writeFile(fixturePath, html, 'utf8');
  await window.loadFile(fixturePath);
  await window.webContents.executeJavaScript(`localStorage.setItem(
    'df.translation.renderCache.v1.signal',
    ${JSON.stringify(JSON.stringify({ entries: [{ sourceHash: hashA, translatedText: translationA }] }))}
  )`);
  await window.webContents.executeJavaScript(runtimeScript, true);

  const legacyPlaintextRemoved = await window.webContents.executeJavaScript(
    `localStorage.getItem('df.translation.renderCache.v1.signal') === null`
  );
  if (!legacyPlaintextRemoved) throw new Error('Legacy plaintext Signal render cache was not removed.');

  async function waitForSingleTranslation(expected, timeoutMs = 250) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const snapshot = await window.webContents.executeJavaScript(`(() => {
        const nodes = Array.from(document.querySelectorAll('.df-chat-translation'));
        return { count: nodes.length, text: nodes[0]?.textContent || '' };
      })()`);
      if (snapshot.count === 1 && snapshot.text === expected) return Date.now() - startedAt;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Expected one cached translation: ${expected}`);
  }

  await waitForSingleTranslation(translationA);
  await window.webContents.executeJavaScript(`(() => {
    const row = document.getElementById('reused-row');
    row.querySelector('.df-chat-translation')?.remove();
    row.dataset.dfCachedTranslatedHash = ${JSON.stringify(hashB)};
    row.querySelector('[dir="auto"]').textContent = ${JSON.stringify(sourceB)};
  })()`);
  await waitForSingleTranslation(translationB);

  const restoredInMs = await window.webContents.executeJavaScript(`(() => {
    const row = document.getElementById('reused-row');
    row.querySelector('.df-chat-translation')?.remove();
    row.dataset.dfCachedTranslatedHash = ${JSON.stringify(hashA)};
    row.querySelector('[dir="auto"]').textContent = ${JSON.stringify(sourceA)};
    return Date.now();
  })()`).then(async (startedAt) => {
    await waitForSingleTranslation(translationA);
    return Date.now() - startedAt;
  });

  if (restoredInMs > 250) throw new Error(`Signal cached translation restored too slowly: ${restoredInMs}ms`);

  const capEntries = Array.from({ length: 1510 }, (_, index) => ({
    sourceHash: `cap-${String(index).padStart(4, '0')}`,
    sourceText: `Cache cap source ${index}`,
    translatedText: `Cache cap translation ${index}`,
    updatedAt: Date.now() + index
  }));
  await window.webContents.executeJavaScript(buildRuntime('signal', capEntries), true);
  const memoryCacheCount = await window.webContents.executeJavaScript(
    `Object.keys(window.__dfCachedTranslationByHash || {}).length`
  );
  if (memoryCacheCount > 1500) throw new Error(`Signal in-memory render cache exceeded 1500 entries: ${memoryCacheCount}`);
  const plaintextStorageValues = await window.webContents.executeJavaScript(`(() => {
    const values = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      values.push(String(localStorage.getItem(key) || ''));
    }
    return values.join('\\n');
  })()`);
  if (plaintextStorageValues.includes(translationA) || plaintextStorageValues.includes('Cache cap translation')) {
    throw new Error('Translation plaintext was written to page localStorage.');
  }
  window.destroy();
  await fs.rm(testRoot, { recursive: true, force: true });
  console.log(`signal-render-cache-runtime: A/B/A restored in ${restoredInMs}ms; plaintext removed; memory cap ${memoryCacheCount}`);
  app.quit();
}

async function runParent() {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [__filename, '--electron-child'], {
      cwd: projectRoot,
      env: { ...process.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Signal render-cache runtime test timed out. ${stderr}`));
    }, 20_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        process.stdout.write(stdout);
        if (!stdout.trim()) console.log('signal-render-cache-runtime: Electron DOM regression passed');
        resolve();
      } else {
        reject(new Error(`Signal render-cache runtime test exited ${code}. ${stderr || stdout}`));
      }
    });
  });
}

const main = process.argv.includes('--electron-child') ? runElectronChild : runParent;
main().catch(async (error) => {
  console.error(error);
  await fs.rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  process.exitCode = 1;
  try {
    require('electron').app?.quit?.();
  } catch {}
});
