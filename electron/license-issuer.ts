import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  type IpcMainInvokeEvent
} from 'electron';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { issueLicenseCode, parseLicenseCode, type LicenseSuitePrivateConfig } from './license-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, '../electron/license-issuer-preload.cjs');
type PackagedIssuerIdentity = {
  suiteId: string;
  keyId: string;
  publicKeySha256: string;
};

type PackagedIssuerKeyFile = PackagedIssuerIdentity & {
  key: string;
};

function readPackagedIssuerKeyFile() {
  return JSON.parse(readFileSync(join(__dirname, 'issuer-suite-key.json'), 'utf8')) as PackagedIssuerKeyFile;
}

function validatePackagedIssuerIdentity(value: PackagedIssuerKeyFile): PackagedIssuerIdentity {
  if (
    !/^\d{9}$/.test(value.suiteId || '') ||
    !value.keyId ||
    !/^[a-f0-9]{64}$/i.test(value.publicKeySha256 || '')
  ) throw new Error('授权套装身份配置无效');
  return {
    suiteId: value.suiteId,
    keyId: value.keyId,
    publicKeySha256: value.publicKeySha256.toLowerCase()
  };
}

const packagedIssuerIdentity = app.isPackaged
  ? validatePackagedIssuerIdentity(readPackagedIssuerKeyFile())
  : null;
const issuerUserDataOverride = process.env.MAOYI_ISSUER_USER_DATA_DIR?.trim();
if (issuerUserDataOverride) {
  if (!isAbsolute(issuerUserDataOverride)) throw new Error('MAOYI_ISSUER_USER_DATA_DIR 必须是绝对路径');
  app.setPath('userData', issuerUserDataOverride);
} else if (packagedIssuerIdentity) {
  app.setPath('userData', join(app.getPath('appData'), 'MAOYI AUTHORIZER', packagedIssuerIdentity.suiteId));
} else {
  app.setPath('userData', join(app.getPath('appData'), 'maoyi-developer-authorizer'));
}
const maxAttempts = 3;
const lockDurationsMs = [10 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 48 * 60 * 60 * 1000];
let issuerWindow: BrowserWindow | null = null;
let authenticated = false;
let suiteCache: LicenseSuitePrivateConfig | null = null;
const issuerVaultScryptN = 1 << 17;
const issuerVaultScryptR = 8;
const issuerVaultScryptP = 1;

protocol.registerSchemesAsPrivileged([{
  scheme: 'issuer-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true }
}]);
app.enableSandbox();

type IssuerState = {
  initialized: boolean;
  passwordSalt?: string;
  passwordHash?: string;
  lockLevel: number;
  failedAttempts: number;
  lockedUntil: number;
  lastSeenAt: number;
};

type IssuerVaultFile = {
  version: 1;
  kdf: 'scrypt';
  n: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

function defaultState(): IssuerState {
  return {
    initialized: false,
    lockLevel: 0,
    failedAttempts: 0,
    lockedUntil: 0,
    lastSeenAt: Date.now()
  };
}

function issuerStatePath() {
  return join(app.getPath('userData'), 'issuer-state.bin');
}

function issuerVaultPath() {
  return join(app.getPath('userData'), 'issuer-vault.dat');
}

function defaultSuitePath() {
  const devPath = join(process.cwd(), '.package-secrets', 'current-license-suite.json');
  if (existsSync(devPath)) return devPath;
  return join(process.resourcesPath, 'license-suite.json');
}

function encryptJson(value: unknown) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows DPAPI 当前不可用');
  const raw = Buffer.from(JSON.stringify(value), 'utf8');
  return safeStorage.encryptString(raw.toString('base64'));
}

function decryptJson<T>(buffer: Buffer): T {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows DPAPI 当前不可用');
  return JSON.parse(Buffer.from(safeStorage.decryptString(buffer), 'base64').toString('utf8')) as T;
}

async function readState(): Promise<IssuerState> {
  try {
    const state = decryptJson<IssuerState>(await readFile(issuerStatePath()));
    const now = Date.now();
    if (state.lastSeenAt && now + 30000 < state.lastSeenAt) {
      state.lockedUntil = Math.max(state.lockedUntil || 0, state.lastSeenAt + lockDurationsMs[Math.min(state.lockLevel, lockDurationsMs.length - 1)]);
    }
    state.lastSeenAt = Math.max(state.lastSeenAt || 0, now);
    await writeState(state);
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    const state = defaultState();
    await writeState(state);
    return state;
  }
}

async function writeState(state: IssuerState) {
  await mkdir(dirname(issuerStatePath()), { recursive: true });
  state.lastSeenAt = Math.max(state.lastSeenAt || 0, Date.now());
  await writeFile(issuerStatePath(), encryptJson(state));
}

function passwordHash(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, 'base64'), 64).toString('base64');
}

function assertPasswordShape(password: string) {
  if (password.length < 8) throw new Error('授权程序密码至少 8 位');
}

function toPublicStatus(state: IssuerState, message?: string) {
  return {
    initialized: state.initialized,
    lockedUntil: state.lockedUntil || 0,
    lockLevel: state.lockLevel || 0,
    attemptsRemaining: Math.max(0, maxAttempts - (state.failedAttempts || 0)),
    message
  };
}

function validatePrivateSuite(suite: LicenseSuitePrivateConfig) {
  if (!suite.suiteId || !suite.privateKeyPem || !suite.publicKeyPem || !suite.keyId) {
    throw new Error('授权套装配置不完整');
  }
  if (
    packagedIssuerIdentity &&
    (
      suite.suiteId !== packagedIssuerIdentity.suiteId ||
      suite.keyId !== packagedIssuerIdentity.keyId ||
      (suite.publicKeySha256 || '').toLowerCase() !== packagedIssuerIdentity.publicKeySha256
    )
  ) throw new Error('授权保险库与当前套装身份不匹配');
  return suite;
}

async function loadBootstrapSuite() {
  if (!app.isPackaged) {
    const suitePath = process.env.MAOYI_LICENSE_SUITE_PATH || defaultSuitePath();
    return validatePrivateSuite(JSON.parse(await readFile(suitePath, 'utf8')) as LicenseSuitePrivateConfig);
  }
  const sealed = JSON.parse(await readFile(join(process.resourcesPath, 'license-suite.sealed'), 'utf8')) as {
    version: number;
    iv: string;
    tag: string;
    ciphertext: string;
  };
  const keyFile = JSON.parse(await readFile(join(__dirname, 'issuer-suite-key.json'), 'utf8')) as PackagedIssuerKeyFile;
  validatePackagedIssuerIdentity(keyFile);
  if (sealed.version !== 1 || !keyFile.key) throw new Error('授权套装密封配置无效');
  const key = Buffer.from(keyFile.key, 'base64');
  const iv = Buffer.from(sealed.iv, 'base64');
  const tag = Buffer.from(sealed.tag, 'base64');
  if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error('授权套装密封参数无效');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const raw = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  key.fill(0);
  return validatePrivateSuite(JSON.parse(raw) as LicenseSuitePrivateConfig);
}

function deriveIssuerVaultKey(password: string, salt: Buffer) {
  return scryptSync(password, salt, 32, {
    N: issuerVaultScryptN,
    r: issuerVaultScryptR,
    p: issuerVaultScryptP,
    maxmem: 256 * 1024 * 1024
  });
}

async function createIssuerVault(password: string) {
  if (existsSync(issuerVaultPath())) {
    if (!app.isPackaged) throw new Error('授权私钥保险库已存在，不能覆盖');
    try {
      const recovered = await unlockIssuerVault(password);
      recovered.key.fill(0);
      return;
    } catch {
      throw new Error('授权私钥保险库已存在，请输入创建保险库时使用的相同密码');
    }
  }
  const suite = await loadBootstrapSuite();
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveIssuerVaultKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('maoyi-issuer-vault-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(suite), 'utf8'), cipher.final()]);
  const vault: IssuerVaultFile = {
    version: 1,
    kdf: 'scrypt',
    n: issuerVaultScryptN,
    r: issuerVaultScryptR,
    p: issuerVaultScryptP,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
  await mkdir(dirname(issuerVaultPath()), { recursive: true });
  await writeFile(issuerVaultPath(), encryptJson(vault));
  key.fill(0);
}

async function unlockIssuerVault(password: string) {
  if (!app.isPackaged) {
    return { suite: await loadBootstrapSuite(), key: Buffer.alloc(0) };
  }
  const vault = decryptJson<IssuerVaultFile>(await readFile(issuerVaultPath()));
  if (
    vault.version !== 1 || vault.kdf !== 'scrypt' ||
    vault.n !== issuerVaultScryptN || vault.r !== issuerVaultScryptR || vault.p !== issuerVaultScryptP
  ) throw new Error('授权私钥保险库参数无效');
  const salt = Buffer.from(vault.salt, 'base64');
  const iv = Buffer.from(vault.iv, 'base64');
  const tag = Buffer.from(vault.tag, 'base64');
  if (salt.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error('授权私钥保险库格式无效');
  const key = deriveIssuerVaultKey(password, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from('maoyi-issuer-vault-v1'));
    decipher.setAuthTag(tag);
    const raw = Buffer.concat([decipher.update(Buffer.from(vault.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    return { suite: validatePrivateSuite(JSON.parse(raw) as LicenseSuitePrivateConfig), key };
  } catch (error) {
    key.fill(0);
    throw error;
  }
}

async function loadSuite() {
  if (!authenticated || !suiteCache) throw new Error('请先登录授权程序');
  return suiteCache;
}

function containedIssuerAsset(relativePath: string) {
  const root = resolve(__dirname, '../license-issuer');
  const target = resolve(root, relativePath);
  const child = relative(root, target);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('授权端资源路径无效');
  return target;
}

function registerIssuerProtocol() {
  protocol.handle('issuer-app', (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'bundle') return new Response('Not found', { status: 404 });
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      return net.fetch(pathToFileURL(containedIssuerAsset(relativePath)).toString());
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function assertIssuerSender(event: IpcMainInvokeEvent) {
  if (
    !issuerWindow || issuerWindow.isDestroyed() ||
    event.sender !== issuerWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== 'issuer-app://bundle/index.html'
  ) throw new Error('已阻止不可信页面调用授权程序');
}

function issuerHandle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
) {
  ipcMain.handle(channel, (event, ...args) => {
    assertIssuerSender(event);
    return handler(event, ...(args as TArgs));
  });
}

function issuerText(value: unknown, label: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) throw new Error(`${label}无效`);
  return value;
}

function createWindow() {
  issuerWindow = new BrowserWindow({
    width: 820,
    height: 640,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: '#08090d',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  issuerWindow.setMenuBarVisibility(false);
  issuerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  issuerWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== 'issuer-app://bundle/index.html') event.preventDefault();
  });
  issuerWindow.once('ready-to-show', async () => {
    issuerWindow?.show();
    const smokeCapturePath = !app.isPackaged ? process.env.MAOYI_ISSUER_SMOKE_CAPTURE_PATH?.trim() : '';
    if (!smokeCapturePath || !issuerWindow) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    const image = await issuerWindow.webContents.capturePage();
    await writeFile(smokeCapturePath, image.toPNG());
    if (process.env.MAOYI_SMOKE_TEST_EXIT === '1') setTimeout(() => app.quit(), 250);
  });
  issuerWindow.loadURL('issuer-app://bundle/index.html');
}

function registerIpc() {
  issuerHandle('issuer:status', async () => toPublicStatus(await readState()));
  issuerHandle('issuer:initialize-password', async (_event, password: string) => {
    issuerText(password, '授权程序密码', 256);
    const state = await readState();
    if (state.initialized) return toPublicStatus(state, '授权程序密码已设置');
    assertPasswordShape(password);
    await createIssuerVault(password);
    const salt = randomBytes(16).toString('base64');
    state.passwordSalt = salt;
    state.passwordHash = passwordHash(password, salt);
    state.initialized = true;
    state.failedAttempts = 0;
    state.lockLevel = 0;
    state.lockedUntil = 0;
    await writeState(state);
    return toPublicStatus(state, '授权程序密码已设置，请牢记');
  });
  issuerHandle('issuer:login', async (_event, password: string) => {
    issuerText(password, '授权程序密码', 256);
    const state = await readState();
    const now = Date.now();
    if (!state.initialized) return { ...toPublicStatus(state, '请先设置授权程序密码'), authenticated: false };
    if (state.lockedUntil && now < state.lockedUntil) return { ...toPublicStatus(state, '授权程序已锁定'), authenticated: false };
    const expected = Buffer.from(state.passwordHash || '', 'base64');
    const actual = Buffer.from(passwordHash(password, state.passwordSalt || ''), 'base64');
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (ok) {
      const unlocked = await unlockIssuerVault(password);
      unlocked.key.fill(0);
      suiteCache = unlocked.suite;
      authenticated = true;
      state.failedAttempts = 0;
      state.lockLevel = 0;
      state.lockedUntil = 0;
      await writeState(state);
      return { ...toPublicStatus(state, '登录成功'), authenticated: true };
    }
    authenticated = false;
    suiteCache = null;
    state.failedAttempts = (state.failedAttempts || 0) + 1;
    let message = `密码错误，还可尝试 ${Math.max(0, maxAttempts - state.failedAttempts)} 次`;
    if (state.failedAttempts >= maxAttempts) {
      const duration = lockDurationsMs[Math.min(state.lockLevel, lockDurationsMs.length - 1)];
      state.lockedUntil = now + duration;
      state.lockLevel = (state.lockLevel || 0) + 1;
      state.failedAttempts = 0;
      message = state.lockLevel >= 2 ? '请联系供应商' : '授权程序已锁定';
    }
    await writeState(state);
    return { ...toPublicStatus(state, message), authenticated: false };
  });
  issuerHandle('issuer:suite-summary', async () => {
    const suite = await loadSuite();
    return { suiteId: suite.suiteId, keyId: suite.keyId, publicKeySha256: suite.publicKeySha256 };
  });
  issuerHandle('issuer:issue-license', async (_event, input: Record<string, unknown>) => {
    if (!authenticated) throw new Error('请先登录授权程序');
    if (!input || typeof input !== 'object' || Buffer.byteLength(JSON.stringify(input), 'utf8') > 16 * 1024) throw new Error('授权输入无效');
    const suite = await loadSuite();
    const authorizedDays = Number(input.authorizedDays || 0);
    if (!Number.isInteger(authorizedDays) || authorizedDays < 1 || authorizedDays > 36500) throw new Error('授权天数必须为 1 至 36500 天');
    const licenseCode = issueLicenseCode({
      suite,
      machineCode: issuerText(input.machineCode, '本机码', 4096),
      username: issuerText(input.username, '用户名', 64),
      serviceSecret: issuerText(input.serviceSecret, '密钥', 4096),
      authorizedDays
    });
    const envelope = parseLicenseCode(licenseCode);
    return {
      licenseCode,
      suiteId: suite.suiteId,
      keyId: suite.keyId,
      licenseId: createHash('sha256').update(envelope.ciphertext).digest('hex').slice(0, 16)
    };
  });
  issuerHandle('issuer:copy-text', (_event, text: string) => {
    clipboard.writeText(issuerText(text, '复制内容', 32 * 1024, true));
  });
  issuerHandle('issuer:save-license-dat', async (_event, licenseCode: string) => {
    if (!authenticated) throw new Error('请先登录授权程序');
    issuerText(licenseCode, '授权码', 32 * 1024);
    const options = {
      title: '保存 license.dat',
      defaultPath: 'license.dat',
      filters: [{ name: 'License', extensions: ['dat', 'txt'] }]
    };
    const result = issuerWindow ? await dialog.showSaveDialog(issuerWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { canceled: true };
    await writeFile(result.filePath, licenseCode.trim() + '\n', 'utf8');
    return { path: result.filePath };
  });
  issuerHandle('window:minimize', () => issuerWindow?.minimize());
  issuerHandle('window:close', () => issuerWindow?.close());
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIssuerProtocol();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
