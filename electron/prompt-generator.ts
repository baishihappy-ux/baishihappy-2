import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  type IpcMainInvokeEvent
} from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  encryptTranslationPromptBundle,
  translationPromptBundleFileName
} from './translation-prompt-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, '../electron/prompt-generator-preload.cjs');
let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([{
  scheme: 'prompt-generator',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true }
}]);
app.enableSandbox();

function containedAsset(relativePath: string) {
  const root = resolve(__dirname, '../prompt-generator');
  const target = resolve(root, relativePath);
  const child = relative(root, target);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('生成器资源路径无效');
  return target;
}

function assertTrustedSender(event: IpcMainInvokeEvent) {
  if (
    !mainWindow || mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== 'prompt-generator://bundle/index.html'
  ) throw new Error('已阻止不可信页面调用提示词生成器');
}

function safeText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${label}无效`);
  return value;
}

function registerProtocol() {
  protocol.handle('prompt-generator', request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'bundle') return new Response('Not found', { status: 404 });
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      return net.fetch(pathToFileURL(containedAsset(relativePath)).toString());
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function registerIpc() {
  ipcMain.handle('prompt-generator:defaults', async event => {
    assertTrustedSender(event);
    const sourcePath = app.isPackaged
      ? join(process.resourcesPath, 'translation-prompts.source.json')
      : join(process.cwd(), 'config', 'translation-prompts.default.json');
    const parsed = JSON.parse((await readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>;
    return {
      chineseToEnglish: safeText(parsed.chineseToEnglish, '默认中译英提示词', 24_000),
      englishToChinese: safeText(parsed.englishToChinese, '默认英译中提示词', 24_000)
    };
  });
  ipcMain.handle('prompt-generator:generate', async (event, input: unknown) => {
    assertTrustedSender(event);
    if (!input || typeof input !== 'object') throw new Error('输入内容无效');
    const value = input as Record<string, unknown>;
    const secret = safeText(value.secret, 'DeepSeek 密钥', 4096);
    const chineseToEnglish = safeText(value.chineseToEnglish, '中译英提示词', 24_000);
    const englishToChinese = safeText(value.englishToChinese, '英译中提示词', 24_000);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: '保存加密提示词文件',
      defaultPath: translationPromptBundleFileName,
      buttonLabel: '生成并保存',
      filters: [{ name: 'maoyi加密提示词文件', extensions: ['dfp'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const targetPath = result.filePath.toLowerCase().endsWith('.dfp')
      ? result.filePath
      : `${result.filePath}.dfp`;
    const encrypted = encryptTranslationPromptBundle(secret, { chineseToEnglish, englishToChinese });
    await writeFile(targetPath, encrypted, { encoding: 'utf8', mode: 0o600 });
    return { ok: true, fileName: targetPath.split(/[\\/]/).pop() || translationPromptBundleFileName };
  });
  ipcMain.handle('window:minimize', event => {
    assertTrustedSender(event);
    mainWindow?.minimize();
  });
  ipcMain.handle('window:close', event => {
    assertTrustedSender(event);
    mainWindow?.close();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 760,
    minWidth: 760,
    minHeight: 650,
    show: false,
    backgroundColor: '#0b0c10',
    title: 'maoyi提示词文件生成器',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== 'prompt-generator://bundle/index.html') event.preventDefault();
  });
  mainWindow.once('ready-to-show', async () => {
    mainWindow?.show();
    const capturePath = !app.isPackaged ? process.env.MAOYI_PROMPT_GENERATOR_SMOKE_CAPTURE_PATH?.trim() : '';
    if (!capturePath || !mainWindow) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 400));
    await mkdir(dirname(capturePath), { recursive: true });
    const image = await mainWindow.webContents.capturePage();
    await writeFile(capturePath, image.toPNG());
    if (process.env.MAOYI_SMOKE_TEST_EXIT === '1') setTimeout(() => app.quit(), 200);
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL('prompt-generator://bundle/index.html');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerProtocol();
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    callback({ cancel: true });
  });
  registerIpc();
  createWindow();
}).catch(error => {
  dialog.showErrorBox('maoyi提示词文件生成器', error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
