import {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  screen,
  session,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session
} from 'electron';
import { appendFile, cp, readdir, readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { cpus, freemem, totalmem } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  AppConfig,
  ChatProfile,
  FingerprintProfile,
  Platform,
  PlatformInfo,
  SendAuthorizationRequest,
  SensitiveSendAuthorizeRequest,
  SensitiveSendPrepareRequest,
  SensitiveSendRequest,
  SignalWorkspaceBounds,
  TranslateRequest,
  TranslationCacheEntry,
  TranslationCacheLoadRequest,
  TranslationCacheLookupRequest,
  TranslationCacheSetRequest,
  NonEnglishContactRequest,
  LockScreenStatus,
  LockScreenSetPinResult,
  LockScreenUnlockResult
} from './shared.js';
import { ClientLicenseManager } from './client-license.js';
import {
  cloneResetArgument,
  cloneResetPlanPathFromArgs,
  cloneResetWorkerDataPath,
  createCloneResetPlan,
  runCloneResetWorker
} from './clone-reset.js';
import {
  createSignalLaunchCredential,
  type RuntimeBindingPayload
} from './runtime-security-core.js';
import {
  defaultRuntimeBindingPath,
  ensureRuntimeBinding,
  ensureSignalInstanceBinding,
  inspectRuntimeBinding,
  mirrorRuntimeBinding
} from './runtime-security.js';
import {
  decryptTranslationCacheRecord,
  encryptTranslationCacheRecord,
  type EncryptedTranslationCacheRecord
} from './translation-cache-crypto.js';
import {
  inspectSensitiveSendText,
  isAllowedWalletNetwork,
  type WalletNetwork
} from './payment-address.js';
import { SensitiveSendAuthorizationStore } from './sensitive-send-authorization.js';

const defaultModel = 'deepseek-v4-flash';
const appDisplayName = 'maoyi';
const appUserDataDirName = 'maoyi';
const appDataFolderName = 'maoyi Data';
const storageBootstrapDirName = 'maoyi Launcher';
const windowsAppUserModelId = 'maoyi.translator';
const legacyUserDataDirName = 'chat-translator';
const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, '../electron/preload.cjs');
const cloneResetPlanPath = cloneResetPlanPathFromArgs();
const cloneResetWorkerMode = Boolean(cloneResetPlanPath);

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true
  }
}]);
app.enableSandbox();

const platformDefaults: Record<Platform, { label: string; url: string }> = {
  whatsapp: { label: 'WhatsApp', url: 'https://web.whatsapp.com/' },
  'telegram-a': { label: 'Telegram A', url: 'https://web.telegram.org/a' },
  'telegram-k': { label: 'Telegram K', url: 'https://web.telegram.org/k/' },
  signal: { label: 'Signal', url: '' }
};

const whatsappUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const telegramUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Safari/537.36';
const defaultBrowserUserAgent = whatsappUserAgent;
const userDataOverride = process.env.MAOYI_USER_DATA_DIR?.trim() || '';
const defaultUserDataPath = join(app.getPath('appData'), appUserDataDirName);
const runtimeLoggingEnabled = !app.isPackaged;
app.setName(appDisplayName);
if (process.platform === 'win32') {
  app.setAppUserModelId(windowsAppUserModelId);
}
const initialUserDataPath = cloneResetWorkerMode
  ? cloneResetWorkerDataPath(cloneResetPlanPath)
  : userDataOverride || defaultUserDataPath;
app.setPath('userData', initialUserDataPath);
app.setPath('sessionData', initialUserDataPath);
app.userAgentFallback = defaultBrowserUserAgent;
app.commandLine.appendSwitch(
  'disable-features',
  'ImeThread,SpareRendererForSitePerProcess,SpellChecking,SpellingService,V8CodeCache,WinDelaySpellcheckServiceInit'
);

let mainWindow: BrowserWindow | null = null;
const compactWindowWidth = 1100;
const compactWindowHeight = 720;
let clientLicenseManager: ClientLicenseManager | null = null;
let authorizedRuntimePrepared = false;
let activeRuntimeSecurity: { payload: RuntimeBindingPayload; devicePrivateKeyPem: string } | null = null;
const configuredPartitions = new Set<string>();
const partitionPolicies = new Map<string, Platform>();
const sessionPolicies = new Map<Session, Platform>();
const translationCacheWriteQueues = new Map<string, Promise<void>>();
const translationCacheChunkRecordLimit = 1000;
const translationCacheChunkByteLimit = 2 * 1024 * 1024;
const visibleMessageDeepSeekDedupe = new Map<string, Promise<string>>();
const approvedComposerTranslations = new Map<string, {
  profileId: string;
  platform: Platform;
  conversationSignature: string;
  textHash: string;
  expiresAt: number;
}>();
const approvedComposerTranslationTtlMs = 10 * 60 * 1000;
const sensitiveSendAuthorizations = new SensitiveSendAuthorizationStore();
type TranslationCacheChunkMeta = {
  file: string;
  count: number;
  bytes: number;
  minUpdatedAt: number;
  maxUpdatedAt: number;
};
type TranslationCacheIndex = {
  schemaVersion: 3;
  updatedAt: number;
  chunks: TranslationCacheChunkMeta[];
  oldestViewedKey?: string;
  oldestViewedAt?: number;
  lastViewedRange?: string;
};
type TranslationCacheKeyFile = {
  schemaVersion: 3;
  suiteId: string;
  dataRootId: string;
  protectedKey: string;
  createdAt: string;
};
let translationCacheKey: Buffer | null = null;
let translationCacheInitialization: Promise<void> | null = null;
const signalProcesses = new Map<string, ChildProcess>();
const signalLaunchPromises = new Map<string, Promise<{ pid: number | null; dataDir: string; wsPort?: number; recovered?: boolean }>>();
type SignalControlSession = {
  processId: number;
  key: Buffer;
  createdAt: number;
};
type SignalControlClient = SignalControlSession & {
  socket: Socket;
  connectedAt: number;
  lastSeenAt: number;
  sendSequence: number;
  receiveSequence: number;
};
const signalControlSessions = new Map<string, SignalControlSession>();
const signalControlClients = new Map<string, SignalControlClient>();
const signalScriptRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>();
const signalStartupRecoveryAttempts = new Set<string>();
const pendingSignalWorkspaceBounds = new Map<string, SignalWorkspaceBounds>();
const lastSignalScreenBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
let visibleSignalProfileId: string | null = null;
let signalMoveSyncTimer: ReturnType<typeof setTimeout> | null = null;
let signalMoveFinalTimer: ReturnType<typeof setTimeout> | null = null;
let focusedSignalProfileId: string | null = null;
let appGroupBlurTimer: ReturnType<typeof setTimeout> | null = null;
const signalMoveSyncIntervalMs = 16;
const signalMoveFinalDelayMs = 48;
const appGroupBlurDelayMs = 120;
const signalControlHandshakeTimeoutMs = 5_000;
const signalControlMaxFrameBytes = 1024 * 1024;
const signalControlMaxSockets = 64;
let signalShutdownBeforeQuitDone = false;
let signalShutdownBeforeQuitPromise: Promise<void> | null = null;
let signalShutdownBeforeQuitTimer: NodeJS.Timeout | null = null;
let signalControlServer: Server | null = null;
let signalControlPort: number | null = null;
let signalControlServerPromise: Promise<number> | null = null;
const gracefulQuitTimeoutMs = 8000;
const rendererReadyTimeoutMs = 5000;
let fatalStartupDialogShown = false;
const profileIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supportedPlatforms = new Set<Platform>(['whatsapp', 'telegram-a', 'telegram-k', 'signal']);

function assertProfileId(value: string) {
  if (!profileIdPattern.test(value)) throw new Error('Profile ID is invalid.');
  return value;
}

function containedPath(root: string, ...parts: string[]) {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, ...parts);
  const child = relative(resolvedRoot, candidate);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Resolved path escaped its authorized data root.');
  }
  return candidate;
}

function startupErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return `${error.message}\n\n${error.stack || ''}`.trim();
  }
  return String(error || '未知错误');
}

function showFatalStartupError(error: unknown) {
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  if (fatalStartupDialogShown || windowVisible) return;
  fatalStartupDialogShown = true;
  dialog.showErrorBox(
    'maoyi 启动失败',
    `程序启动时遇到错误，请截图发给供应商。\n\n${startupErrorMessage(error)}`
  );
  app.quit();
}

function isTrustedMainUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'app:' && url.hostname === 'bundle') return true;
    return !app.isPackaged && url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '5173';
  } catch {
    return false;
  }
}

function isAllowedPlatformUrl(platform: Platform, value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (platform === 'whatsapp') return url.hostname === 'web.whatsapp.com';
    if (platform === 'telegram-k') return url.hostname === 'web.telegram.org' && (url.pathname === '/k' || url.pathname.startsWith('/k/'));
    if (platform === 'telegram-a') return url.hostname === 'web.telegram.org' && (url.pathname === '/a' || url.pathname.startsWith('/a/'));
    return false;
  } catch {
    return false;
  }
}

function installWebContentsSecurityPolicy() {
  app.on('web-contents-created', (_event, contents) => {
    const platform = sessionPolicies.get(contents.session);
    if (!platform) return;

    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, targetUrl) => {
      if (!isAllowedPlatformUrl(platform, targetUrl)) event.preventDefault();
    });
  });
}

function registerLocalAppProtocol() {
  const bundleRoot = resolve(__dirname, '../dist');
  protocol.handle('app', (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'bundle') return new Response('Not found', { status: 404 });
      const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const target = containedPath(bundleRoot, relativePath);
      return net.fetch(pathToFileURL(target).toString());
    } catch {
      return new Response('Bad request', { status: 400 });
    }
  });
}

function assertClientRuntimeAllowed() {
  if (!clientLicenseManager) throw new Error('客户端授权模块尚未初始化');
  clientLicenseManager.assertRuntimeAllowed();
}

process.on('uncaughtException', showFatalStartupError);
process.on('unhandledRejection', showFatalStartupError);

const gotSingleInstanceLock = cloneResetWorkerMode || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

if (!cloneResetWorkerMode) app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  requestSignalWorkspaceSyncBurst();
});

function storageBootstrapPath() {
  return join(app.getPath('appData'), storageBootstrapDirName, 'storage.json');
}

function applyUserDataPath(dataPath: string) {
  app.setPath('userData', dataPath);
  app.setPath('sessionData', dataPath);
}

async function saveStorageBootstrap(dataPath: string) {
  const bootstrapPath = storageBootstrapPath();
  await mkdir(dirname(bootstrapPath), { recursive: true });
  await writeFile(bootstrapPath, `${JSON.stringify({ dataPath }, null, 2)}\n`, 'utf8');
}

async function initializeUserDataPath() {
  if (userDataOverride) {
    await mkdir(userDataOverride, { recursive: true });
    applyUserDataPath(userDataOverride);
    return true;
  }

  try {
    const raw = (await readFile(storageBootstrapPath(), 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as { dataPath?: unknown };
    if (typeof parsed.dataPath === 'string' && parsed.dataPath.trim()) {
      const dataPath = parsed.dataPath.trim();
      await mkdir(dataPath, { recursive: true });
      applyUserDataPath(dataPath);
      return true;
    }
  } catch {
    // First launch continues to existing-data detection or storage selection.
  }

  const existingDataMarkers = ['config.json', 'profiles.json', 'Partitions', 'SignalInstances'];
  for (const marker of existingDataMarkers) {
    if (await pathExists(join(defaultUserDataPath, marker))) {
      await saveStorageBootstrap(defaultUserDataPath);
      applyUserDataPath(defaultUserDataPath);
      return true;
    }
  }

  const selection = await dialog.showOpenDialog({
    title: '选择 maoyi 数据保存位置',
    buttonLabel: '选择并创建数据目录',
    properties: ['openDirectory', 'createDirectory']
  });
  if (selection.canceled || !selection.filePaths[0]) {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'maoyi',
      message: '未选择数据保存位置，程序未启动。',
      detail: '请重新打开程序，并选择一个可写入的磁盘文件夹。'
    });
    return false;
  }

  const dataPath = join(selection.filePaths[0], appDataFolderName);
  await mkdir(dataPath, { recursive: true });
  await saveStorageBootstrap(dataPath);
  applyUserDataPath(dataPath);
  return true;
}

function configPath() {
  return join(app.getPath('userData'), 'config.json');
}

function legacyUserDataDirCandidates() {
  if (userDataOverride) return [];
  return [
    join(app.getPath('appData'), appDisplayName),
    join(app.getPath('appData'), 'maoyi Legacy')
  ].filter((path, index, paths) => path !== app.getPath('userData') && paths.indexOf(path) === index);
}

function profilesPath() {
  return join(app.getPath('userData'), 'profiles.json');
}

function lockScreenPath() {
  return join(app.getPath('userData'), 'lock-screen.json');
}

function translateRequestLogPath() {
  return join(app.getPath('userData'), 'translate-requests.jsonl');
}

function signalTranslationDebugLogPath() {
  return join(app.getPath('userData'), 'signal-translation-debug.jsonl');
}

function partitionStoragePath(partition: string) {
  const match = /^persist:chat-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(partition);
  if (!match) return null;
  return containedPath(join(app.getPath('userData'), 'Partitions'), `chat-${match[1]}`);
}

function signalInstancesRoot() {
  return join(app.getPath('userData'), 'SignalInstances');
}

function signalInstancePath(id: string) {
  assertProfileId(id);
  return containedPath(signalInstancesRoot(), `Signal-${id}`);
}

function signalAppId(id: string) {
  return `Signal-${id}`;
}

function profileIdFromSignalAppId(appId: string) {
  return appId.startsWith('Signal-') ? appId.slice('Signal-'.length) : appId;
}

function signalControlStatusPath() {
  return join(app.getPath('userData'), 'signal-control-status.json');
}

function signalExecutableCandidates() {
  const developmentExecutable = join(process.cwd(), '.runtime', 'signal-desktop', 'Signal.exe');
  const packagedExecutable = join(process.resourcesPath || '', 'signal', 'Signal.exe');
  return app.isPackaged ? [packagedExecutable] : [developmentExecutable];
}

function signalRuntimeBindingPath(executablePath: string) {
  return join(dirname(executablePath), 'resources', 'df-runtime-binding.dat');
}

function translationCacheRoot() {
  return join(app.getPath('userData'), 'TranslationCache');
}

function translationCacheKeyPath() {
  return join(app.getPath('userData'), 'translation-cache-key.dat');
}

async function initializeTranslationCacheEncryption(binding: RuntimeBindingPayload) {
  if (translationCacheKey) return;
  if (translationCacheInitialization) return translationCacheInitialization;
  translationCacheInitialization = (async () => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows DPAPI 当前不可用，无法加密翻译缓存');
    try {
      const file = JSON.parse(await readFile(translationCacheKeyPath(), 'utf8')) as TranslationCacheKeyFile;
      if (
        file.schemaVersion !== 3 ||
        file.suiteId !== binding.suiteId ||
        file.dataRootId !== binding.dataRootId ||
        !file.protectedKey
      ) throw new Error('翻译缓存密钥与当前授权数据根不匹配');
      const key = Buffer.from(safeStorage.decryptString(Buffer.from(file.protectedKey, 'base64')), 'base64');
      if (key.length !== 32) throw new Error('翻译缓存密钥长度无效');
      translationCacheKey = key;
      await cleanupLegacyTranslationCacheArtifacts();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }

    await rm(translationCacheRoot(), { recursive: true, force: true });
    const key = randomBytes(32);
    const file: TranslationCacheKeyFile = {
      schemaVersion: 3,
      suiteId: binding.suiteId,
      dataRootId: binding.dataRootId,
      protectedKey: safeStorage.encryptString(key.toString('base64')).toString('base64'),
      createdAt: new Date().toISOString()
    };
    await writeJsonAtomic(translationCacheKeyPath(), file);
    translationCacheKey = key;
  })().finally(() => {
    translationCacheInitialization = null;
  });
  return translationCacheInitialization;
}

async function cleanupLegacyTranslationCacheArtifacts() {
  let entries: Dirent[];
  try {
    entries = await readdir(translationCacheRoot(), { withFileTypes: true });
  } catch {
    return;
  }
  const removable = entries.filter((entry) =>
    (entry.isDirectory() && (entry.name === 'v2' || supportedPlatforms.has(entry.name as Platform))) ||
    (entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
  );
  await Promise.all(removable.map((entry) => removePathWithRetry(containedPath(translationCacheRoot(), entry.name))));
}

function requireTranslationCacheKey() {
  if (!translationCacheKey || !activeRuntimeSecurity) throw new Error('翻译缓存加密尚未初始化');
  return translationCacheKey;
}

function translationCacheRecordAad(cacheDir: string, chunkFile: string) {
  if (!activeRuntimeSecurity) throw new Error('翻译缓存运行时绑定尚未建立');
  const relativeDir = relative(resolve(translationCacheRoot()), resolve(cacheDir));
  if (!relativeDir || relativeDir.startsWith('..') || isAbsolute(relativeDir)) {
    throw new Error('翻译缓存目录越过授权数据根');
  }
  return Buffer.from(JSON.stringify([
    'maoyi-translation-cache-v3',
    activeRuntimeSecurity.payload.suiteId,
    activeRuntimeSecurity.payload.dataRootId,
    relativeDir.replace(/\\/g, '/'),
    chunkFile
  ]));
}

function encryptTranslationCacheEntry(cacheDir: string, chunkFile: string, entry: TranslationCacheEntry) {
  return encryptTranslationCacheRecord(
    requireTranslationCacheKey(),
    translationCacheRecordAad(cacheDir, chunkFile),
    entry
  );
}

function decryptTranslationCacheEntry(cacheDir: string, chunkFile: string, record: EncryptedTranslationCacheRecord) {
  return decryptTranslationCacheRecord<TranslationCacheEntry>(
    requireTranslationCacheKey(),
    translationCacheRecordAad(cacheDir, chunkFile),
    record
  );
}

type LockScreenState = {
  version: number;
  enabled: boolean;
  salt: string;
  pinHash: string;
  failedAttempts: number;
  lockedUntil: number;
  createdAt: number;
  updatedAt: number;
};

const lockScreenMaxAttempts = 3;

function defaultLockScreenStatus(): LockScreenStatus {
  return {
    enabled: false,
    lockedUntil: 0,
    failedAttempts: 0,
    maxAttempts: lockScreenMaxAttempts
  };
}

function lockScreenStatusFromState(state: LockScreenState | null): LockScreenStatus {
  if (!state?.enabled) return defaultLockScreenStatus();
  return {
    enabled: true,
    lockedUntil: state.lockedUntil || 0,
    failedAttempts: state.failedAttempts || 0,
    maxAttempts: lockScreenMaxAttempts
  };
}

async function readLockScreenState(): Promise<LockScreenState | null> {
  try {
    return JSON.parse(await readFile(lockScreenPath(), 'utf8')) as LockScreenState;
  } catch {
    return null;
  }
}

async function writeLockScreenState(state: LockScreenState) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(lockScreenPath(), JSON.stringify(state, null, 2), 'utf8');
}

function assertLockPin(pin: string) {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('锁屏 PIN 必须是 6 位数字');
  }
}

function hashLockPin(pin: string, salt: string) {
  return scryptSync(pin, Buffer.from(salt, 'base64'), 64).toString('base64');
}

async function getLockScreenStatus(): Promise<LockScreenStatus> {
  return lockScreenStatusFromState(await readLockScreenState());
}

async function setLockScreenPin(pin: string): Promise<LockScreenSetPinResult> {
  try {
    assertLockPin(pin);
    const now = Date.now();
    const salt = randomBytes(16).toString('base64');
    const state: LockScreenState = {
      version: 1,
      enabled: true,
      salt,
      pinHash: hashLockPin(pin, salt),
      failedAttempts: 0,
      lockedUntil: 0,
      createdAt: now,
      updatedAt: now
    };
    await writeLockScreenState(state);
    return { ok: true, status: lockScreenStatusFromState(state) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '设置锁屏 PIN 失败', status: await getLockScreenStatus() };
  }
}

async function unlockLockScreen(pin: string): Promise<LockScreenUnlockResult> {
  const state = await readLockScreenState();
  if (!state?.enabled) return { ok: false, reason: '请先设置锁屏 PIN', status: defaultLockScreenStatus() };
  const now = Date.now();
  let validPin = true;
  try {
    assertLockPin(pin);
  } catch {
    validPin = false;
  }
  const expected = Buffer.from(state.pinHash || '', 'base64');
  const actual = validPin ? Buffer.from(hashLockPin(pin, state.salt || ''), 'base64') : Buffer.alloc(0);
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (ok) {
    state.failedAttempts = 0;
    state.lockedUntil = 0;
    state.updatedAt = now;
    await writeLockScreenState(state);
    return { ok: true, status: lockScreenStatusFromState(state) };
  }

  state.failedAttempts = (state.failedAttempts || 0) + 1;
  let reason = `PIN 错误，还可尝试 ${Math.max(0, lockScreenMaxAttempts - state.failedAttempts)} 次`;
  if (state.failedAttempts >= lockScreenMaxAttempts) {
    state.failedAttempts = lockScreenMaxAttempts;
    state.lockedUntil = 0;
    reason = '请重置 PIN';
  }
  state.updatedAt = now;
  await writeLockScreenState(state);
  return { ok: false, reason, status: lockScreenStatusFromState(state) };
}

function isEnglishChatSource(value: string | undefined) {
  const text = (value || '').trim();
  if (!/[A-Za-z]/.test(text)) return false;
  return !/[\u3400-\u9fff]/u.test(text);
}

function nonEnglishContactMarkerPath(request: NonEnglishContactRequest) {
  const identity = request.contactId || request.contactTitle || 'unknown-contact';
  return join(
    translationCacheRoot(),
    'excluded-contacts',
    safePathPart(request.platform || 'unknown'),
    safeProfileFileName(request.profileId),
    `${safePathPart(request.contactIdType || 'unknown')}-${hashForLog(identity)}.json`
  );
}

async function isMarkedNonEnglishContact(request: NonEnglishContactRequest) {
  if (!request.profileId || (!request.contactId && !request.contactTitle)) return false;
  return pathExists(nonEnglishContactMarkerPath(request));
}

async function markNonEnglishContact(request: NonEnglishContactRequest) {
  if (!request.profileId || (!request.contactId && !request.contactTitle)) return;
  const markerPath = nonEnglishContactMarkerPath(request);
  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({ schemaVersion: 1, markedAt: new Date().toISOString() })}\n`, 'utf8');
  await rm(chunkedTranslationCacheDir(request), { recursive: true, force: true });
}

function safeProfileFileName(profileId: string) {
  return assertProfileId(profileId);
}

function safePathPart(value: string) {
  return (value || 'unknown')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'unknown';
}

function translationCacheContactKey(request: TranslationCacheLoadRequest | TranslationCacheSetRequest) {
  if (request.contactId) {
    return safePathPart(`${request.contactIdType || 'unknown'}-${request.contactId}`);
  }
  return 'unknown-contact';
}

function chunkedTranslationCacheDir(request: TranslationCacheLoadRequest | TranslationCacheSetRequest) {
  return join(
    translationCacheRoot(),
    'v3',
    safePathPart(request.platform || 'unknown-platform'),
    safeProfileFileName(request.profileId),
    translationCacheContactKey(request)
  );
}

function chunkedTranslationCacheIndexPath(request: TranslationCacheLoadRequest | TranslationCacheSetRequest) {
  return join(chunkedTranslationCacheDir(request), 'index.json');
}

function defaultTranslationCacheIndex(): TranslationCacheIndex {
  return {
    schemaVersion: 3,
    updatedAt: Date.now(),
    chunks: []
  };
}

function defaultConfig(): AppConfig {
  return {
    profiles: [],
    activeProfileId: null,
    deepseekModel: defaultModel
  };
}

function getMemoryStatus() {
  const totalBytes = totalmem();
  const freeBytes = freemem();
  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    totalBytes,
    freeBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
  };
}

async function readConfig(): Promise<AppConfig> {
  assertClientRuntimeAllowed();
  await migrateLegacyUserDataDir();
  const fallbackProfiles = await readProfileBackup();
  try {
    const raw = (await readFile(configPath(), 'utf8')).replace(/^\uFEFF/, '');
    const config = sanitizeConfig({ ...defaultConfig(), ...JSON.parse(raw) });
    if (!config.profiles.length && fallbackProfiles.length) {
      return sanitizeConfig({ ...config, profiles: fallbackProfiles, activeProfileId: fallbackProfiles[0]?.id ?? null });
    }
    return config;
  } catch {
    return sanitizeConfig({
      ...defaultConfig(),
      profiles: fallbackProfiles,
      activeProfileId: fallbackProfiles[0]?.id ?? null
    });
  }
}

async function readDevelopmentServiceSecret() {
  if (app.isPackaged) return '';
  const environmentSecret = process.env.MAOYI_SERVICE_SECRET?.trim();
  if (environmentSecret) return environmentSecret;
  try {
    const raw = (await readFile(join(process.cwd(), '.package-secrets', 'trial-config.json'), 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as { deepseekApiKey?: unknown };
    return typeof parsed.deepseekApiKey === 'string' ? parsed.deepseekApiKey.trim() : '';
  } catch {
    return '';
  }
}

async function migrateLegacyUserDataDir() {
  if (await pathExists(configPath())) return;

  for (const sourceDir of legacyUserDataDirCandidates()) {
    if (!(await pathExists(join(sourceDir, 'config.json'))) && !(await pathExists(join(sourceDir, 'profiles.json')))) {
      continue;
    }
    await mkdir(app.getPath('userData'), { recursive: true });
    await copyLegacyConfigFile(sourceDir, 'config.json');
    await copyLegacyConfigFile(sourceDir, 'profiles.json');
    return;
  }
}

async function copyLegacyConfigFile(sourceDir: string, fileName: string) {
  const sourcePath = join(sourceDir, fileName);
  const targetPath = join(app.getPath('userData'), fileName);
  if (!(await pathExists(sourcePath)) || (await pathExists(targetPath))) return;
  await cp(sourcePath, targetPath, { force: false });
}

async function readProfileBackup(): Promise<ChatProfile[]> {
  try {
    const raw = await readFile(profilesPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sanitizeConfig(config: AppConfig): AppConfig {
  const rawProfiles = Array.isArray(config.profiles) ? config.profiles : [];
  const profiles = rawProfiles.filter((profile) => Boolean(
    profile &&
    profileIdPattern.test(profile.id) &&
    supportedPlatforms.has(profile.platform)
  )).map((profile, index) => {
    const fallbackFingerprint = buildFingerprint(index);
    const expectedSignalDataDir = profile.platform === 'signal' ? signalInstancePath(profile.id) : undefined;
    return {
      ...profile,
      name: String(profile.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || platformDefaults[profile.platform].label,
      group: String(profile.group || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || '本组',
      partition: `persist:chat-${profile.id}`,
      signalDataDir: expectedSignalDataDir,
      fingerprint: {
        ...fallbackFingerprint,
        ...profile.fingerprint,
        userAgent: profile.fingerprint?.userAgent || userAgentForPlatform(profile.platform)
      }
    };
  });
  const activeProfileId = profiles.some((profile) => profile.id === config.activeProfileId)
    ? config.activeProfileId
    : profiles[0]?.id ?? null;

  return {
    profiles,
    activeProfileId,
    deepseekModel: typeof config.deepseekModel === 'string' && /^[a-z0-9._-]{1,64}$/i.test(config.deepseekModel)
      ? config.deepseekModel
      : defaultModel
  };
}

function userAgentForPlatform(platform: Platform) {
  if (platform === 'signal') return whatsappUserAgent;
  return platform === 'whatsapp' ? whatsappUserAgent : telegramUserAgent;
}

async function saveConfig(config: AppConfig): Promise<AppConfig> {
  assertClientRuntimeAllowed();
  const sanitizedConfig = sanitizeConfig(config);
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeJsonAtomic(configPath(), sanitizedConfig);
  await writeJsonAtomic(profilesPath(), sanitizedConfig.profiles);
  return sanitizedConfig;
}

async function writeJsonAtomic(path: string, value: unknown) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(path, { force: true });
    await rename(tempPath, path);
  }
}

function hashForLog(text: string) {
  let hash = 2166136261;
  for (const char of text.replace(/\s+/g, ' ').trim()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function appendTranslateRequestLog(event: Record<string, unknown>) {
  if (!runtimeLoggingEnabled) return;
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await appendFile(
      translateRequestLogPath(),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      'utf8'
    );
  } catch {
    // Logging must never block translation.
  }
}

async function appendSignalTranslationDebugLog(event: Record<string, unknown>) {
  if (!runtimeLoggingEnabled) return;
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await appendFile(
      signalTranslationDebugLogPath(),
      `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`,
      'utf8'
    );
  } catch {
    // Diagnostics must never block Signal translation.
  }
}

function randomId() {
  return randomUUID();
}

function buildFingerprint(index: number): FingerprintProfile {
  const renderers = [
    ['Google Inc. (Intel)', 'ANGLE (Intel, Intel UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
    ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)']
  ];
  const renderer = renderers[index % renderers.length];
  const primaryDisplay = screen.getPrimaryDisplay();
  const memoryGb = Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024));

  return {
    fingerprintId: randomId(),
    userAgent: whatsappUserAgent,
    languageSource: 'ip',
    languages: [],
    timezoneSource: 'ip',
    timezone: '',
    webglVendor: renderer[0],
    webglRenderer: renderer[1],
    hardwareSource: 'match',
    hardwareConcurrency: cpus().length || 4,
    deviceMemory: memoryGb,
    canvasSeed: crypto.getRandomValues(new Uint32Array(1))[0],
    screenSource: 'match',
    width: primaryDisplay.workAreaSize.width,
    height: primaryDisplay.workAreaSize.height
  };
}

async function createProfile(platform: Platform, name: string, group: string): Promise<ChatProfile> {
  const config = await readConfig();
  const nextName = name.trim();
  const nextGroup = group.trim();
  if (!nextName) throw new Error('Profile name is required.');
  if (!nextGroup) throw new Error('Profile group is required.');
  const id = randomId();
  const label = platformDefaults[platform].label;
  const samePlatformCount = config.profiles.filter((profile) => profile.platform === platform).length;
  const profile: ChatProfile = {
    id,
    name: nextName || `${label} ${samePlatformCount + 1}`,
    group: nextGroup,
    platform,
    partition: `persist:chat-${id}`,
    signalDataDir: platform === 'signal' ? signalInstancePath(id) : undefined,
    createdAt: Date.now(),
    fingerprint: { ...buildFingerprint(config.profiles.length), userAgent: userAgentForPlatform(platform) }
  };

  if (profile.signalDataDir) {
    await mkdir(profile.signalDataDir, { recursive: true });
    if (activeRuntimeSecurity) {
      await ensureSignalInstanceBinding(
        profile.signalDataDir,
        profile.id,
        activeRuntimeSecurity.payload,
        activeRuntimeSecurity.devicePrivateKeyPem
      );
    }
  }
  config.profiles.push(profile);
  config.activeProfileId = profile.id;
  configureSession(profile);
  await saveConfig(config);
  return profile;
}

async function pathExists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    try {
      await readdir(path);
      return true;
    } catch {
      return false;
    }
  }
}

async function resolveSignalExecutable() {
  for (const candidate of signalExecutableCandidates()) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error(`Signal.exe was not found. Checked: ${signalExecutableCandidates().join('; ')}`);
}

async function containsCloneSensitiveData(dataRoot: string) {
  const markers = [
    'license.dat',
    'client-account.json',
    'config.json',
    'profiles.json',
    'lock-screen.json',
    'Partitions',
    'SignalInstances',
    'TranslationCache',
    'EnterpriseChatAssets'
  ];
  for (const marker of markers) {
    if (await pathExists(join(dataRoot, marker))) return true;
  }
  return false;
}

async function spawnCloneResetWorker(planPath: string) {
  const args = app.isPackaged
    ? [`${cloneResetArgument}${planPath}`]
    : [process.cwd(), `${cloneResetArgument}${planPath}`];
  await new Promise<void>((resolvePromise, reject) => {
    const worker = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    const onError = (error: Error) => reject(error);
    worker.once('error', onError);
    worker.once('spawn', () => {
      worker.off('error', onError);
      worker.unref();
      resolvePromise();
    });
  });
}

async function beginForeignCloneReset(bindingFile?: { dataRootId?: string; suiteId?: string }) {
  if (userDataOverride && process.env.MAOYI_ALLOW_CLONE_RESET_FOR_OVERRIDE !== '1') {
    throw new Error('隔离数据目录被识别为外来克隆；开发环境未启用自动初始化');
  }
  if (!(runtimeLoggingEnabled && process.env.MAOYI_CLONE_RESET_TEST_AUTOCONFIRM === '1')) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: appDisplayName,
      message: '缺少启动器，正在初始化',
      detail: '检测到来自其他电脑的应用数据。本机复制数据将被清除，程序随后退出。',
      buttons: ['确定'],
      defaultId: 0,
      noLink: true
    });
  }
  const { planPath } = await createCloneResetPlan({
    targetRoot: app.getPath('userData'),
    bootstrapPath: userDataOverride ? undefined : storageBootstrapPath(),
    runtimeBindingPaths: signalExecutableCandidates().map(signalRuntimeBindingPath),
    expectedDataRootId: bindingFile?.dataRootId,
    expectedSuiteId: bindingFile?.suiteId,
    parentProcessId: process.pid
  });
  await spawnCloneResetWorker(planPath);
  signalShutdownBeforeQuitDone = true;
  app.exit(0);
}

async function beginAuthorizationSelfDestruct() {
  hideAllSignalWindows();
  dialog.showMessageBoxSync({
    type: 'error',
    title: appDisplayName,
    message: '授权错误次数已达上限',
    detail: '本机客户端已永久锁死，正在清除应用数据并卸载程序。',
    buttons: ['确定'],
    defaultId: 0,
    noLink: true
  });
  const uninstallerPath = app.isPackaged
    ? join(dirname(process.execPath), 'Uninstall maoyi.exe')
    : undefined;
  const { planPath } = await createCloneResetPlan({
    targetRoot: app.getPath('userData'),
    bootstrapPath: userDataOverride ? undefined : storageBootstrapPath(),
    runtimeBindingPaths: signalExecutableCandidates().map(signalRuntimeBindingPath),
    parentProcessId: process.pid,
    uninstallerPath
  });
  await spawnCloneResetWorker(planPath);
  signalShutdownBeforeQuitDone = true;
  app.exit(0);
}

async function verifyRuntimeCloneState() {
  if (!clientLicenseManager) throw new Error('客户端授权模块尚未初始化');
  const expected = clientLicenseManager.getRuntimeSecurityExpectation();
  const inspection = await inspectRuntimeBinding(defaultRuntimeBindingPath(), {
    suiteId: expected.suiteId || undefined,
    keyId: expected.keyId || undefined,
    machineCodeHash: expected.machineCodeHash || undefined,
    hardwareHash: expected.hardwareHash || undefined,
    devicePublicKeyPem: expected.devicePublicKeyPem || undefined
  });
  if (inspection.state === 'local') {
    return true;
  }
  if (inspection.state === 'foreign') {
    await beginForeignCloneReset(inspection.file);
    return false;
  }
  const authorization = clientLicenseManager.getStatus();
  const containsExistingData = await containsCloneSensitiveData(app.getPath('userData'));
  if (
    containsExistingData &&
    (authorization.state === 'device-error' || clientLicenseManager.wasDeviceIdentityCreatedThisRun())
  ) {
    await beginForeignCloneReset();
    return false;
  }
  return true;
}

async function hasSignalStartupCorruption(dataDir: string) {
  const logPath = join(dataDir, 'logs', 'main.log');
  try {
    const raw = await readFile(logPath, 'utf8');
    return /Database startup error|safeStorage\.decryptString|SQLITE_NOTADB|hmac check failed|error decrypting page/i.test(raw);
  } catch {
    return false;
  }
}

async function quarantineSignalDataDir(dataDir: string) {
  if (!(await pathExists(dataDir))) return false;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetPath = `${dataDir}.broken-${stamp}`;
  await renamePathWithRetry(dataDir, targetPath);
  await mkdir(dataDir, { recursive: true });
  return true;
}

async function renamePathWithRetry(sourcePath: string, targetPath: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      await wait(250 + attempt * 250);
    }
  }
  throw lastError;
}

async function ensureSignalRuntimePreferences(dataDir: string) {
  const ephemeralPath = join(dataDir, 'ephemeral.json');
  let preferences: Record<string, unknown> = {};
  try {
    preferences = JSON.parse((await readFile(ephemeralPath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    preferences = {};
  }

  preferences['system-tray-setting'] = 'DoNotUseSystemTray';
  preferences['theme-setting'] = preferences['theme-setting'] || 'system';
  preferences['spell-check'] = preferences['spell-check'] ?? true;
  await writeJsonAtomic(ephemeralPath, preferences);
}

async function cleanupSignalUpdateArtifacts(dataDir: string) {
  const updateCachePath = join(dataDir, 'update-cache');
  await removePathWithRetry(updateCachePath);

  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^signal-desktop.*\.(exe|blockmap)$/i.test(entry.name))
        .map((entry) => removePathWithRetry(join(dataDir, entry.name)))
    );
  } catch {
    // Best-effort cleanup only; Signal launch should not fail because an update cache is locked.
  }
}

async function ensureSignalControlServer() {
  if (signalControlPort) return signalControlPort;
  if (signalControlServerPromise) return signalControlServerPromise;

  signalControlServerPromise = new Promise<number>((resolve, reject) => {
    const server = createServer();
    const sockets = new Set<Socket>();
    let settled = false;

    const listen = (port: number) => {
      server.listen(port, '127.0.0.1');
    };

    const settleResolve = () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) {
        reject(new Error('Signal control server did not expose a port.'));
        return;
      }
      settled = true;
      signalControlServer = server;
      signalControlPort = port;
      resolve(port);
    };

    server.on('upgrade', (request, socket) => {
      const signalSocket = socket as Socket;
      if (sockets.size >= signalControlMaxSockets) {
        signalSocket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }
      sockets.add(signalSocket);
      signalSocket.once('close', () => sockets.delete(signalSocket));
      handleSignalControlUpgrade(request, signalSocket);
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (!settled && error.code === 'EADDRINUSE') {
        server.close(() => listen(0));
        return;
      }
      if (!settled) {
        reject(error);
      }
    });

    server.on('listening', settleResolve);
    server.on('close', () => {
      for (const socket of sockets) socket.destroy();
      signalControlServer = null;
      signalControlPort = null;
      signalControlServerPromise = null;
      signalControlClients.clear();
    });

    listen(0);
  });

  return signalControlServerPromise;
}

function handleSignalControlUpgrade(request: IncomingMessage, socket: Socket) {
  const appId = new URL(request.url || '/', 'ws://127.0.0.1').searchParams.get('appId') || '';
  const key = request.headers['sec-websocket-key'];
  const profileId = profileIdFromSignalAppId(appId);
  const controlSession = signalControlSessions.get(appId);
  if (!profileIdPattern.test(profileId) || typeof key !== 'string' || !controlSession) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }

  const acceptKey = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ].join('\r\n'));

  const challenge = randomBytes(32).toString('base64url');
  let authenticated = false;
  const handshakeTimer = setTimeout(() => socket.destroy(), signalControlHandshakeTimeoutMs);
  writeSignalWebSocketText(socket, JSON.stringify({ type: 'auth.challenge', appId, challenge }));

  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    if (buffered.length > signalControlMaxFrameBytes * 2) {
      socket.destroy();
      return;
    }
    try {
      const parsed = readSignalWebSocketFrames(buffered);
      buffered = parsed.remaining;
      for (const frame of parsed.frames) {
        if (!authenticated) {
          const response = JSON.parse(frame) as { type?: string; processId?: number; mac?: string };
          const expectedMac = signalControlMac(controlSession.key, [
            'maoyi-signal-control-auth-v1',
            appId,
            controlSession.processId,
            challenge
          ]);
          if (
            response.type !== 'auth.response' ||
            response.processId !== controlSession.processId ||
            !constantTimeBase64UrlEqual(response.mac, expectedMac)
          ) {
            socket.destroy();
            return;
          }
          authenticated = true;
          clearTimeout(handshakeTimer);
          const existing = signalControlClients.get(appId);
          existing?.socket.destroy();
          signalControlClients.set(appId, {
            ...controlSession,
            socket,
            connectedAt: Date.now(),
            lastSeenAt: Date.now(),
            sendSequence: 0,
            receiveSequence: 0
          });
          void persistSignalControlStatus();
          sendSignalControlMessage(appId, { type: 'hello', appId, at: Date.now() });
          continue;
        }
        const payload = verifySignalControlEnvelope(appId, frame);
        if (!payload) {
          socket.destroy();
          return;
        }
        handleSignalControlMessage(appId, payload);
      }
    } catch {
      socket.destroy();
    }
  });
  socket.on('error', () => undefined);
  socket.once('close', () => {
    clearTimeout(handshakeTimer);
    const current = signalControlClients.get(appId);
    if (current?.socket === socket) {
      signalControlClients.delete(appId);
      void persistSignalControlStatus();
    }
  });
}

function readSignalWebSocketFrames(buffer: Buffer) {
  const frames: string[] = [];
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
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(signalControlMaxFrameBytes)) throw new Error('Signal control frame is too large.');
      length = Number(bigLength);
      headerLength = 10;
    }
    if (length > signalControlMaxFrameBytes) throw new Error('Signal control frame is too large.');
    if (!masked) throw new Error('Signal control client frames must be masked.');

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) break;

    if (opcode === 0x8) {
      offset += frameLength;
      continue;
    }

    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      const decoded = Buffer.alloc(payload.length);
      for (let index = 0; index < payload.length; index += 1) {
        decoded[index] = payload[index] ^ mask[index % 4];
      }
      payload = decoded;
    }
    if (opcode === 0x1) {
      frames.push(payload.toString('utf8'));
    }
    offset += frameLength;
  }

  return { frames, remaining: buffer.subarray(offset) };
}

function writeSignalWebSocketText(socket: Socket, value: string) {
  const message = Buffer.from(value, 'utf8');
  if (message.length > signalControlMaxFrameBytes) throw new Error('Signal control message is too large.');
  let header: Buffer;
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

function signalControlMac(key: Buffer, values: unknown[]) {
  return createHmac('sha256', key).update(JSON.stringify(values)).digest('base64url');
}

function constantTimeBase64UrlEqual(actual: unknown, expected: string) {
  if (typeof actual !== 'string') return false;
  try {
    const actualBuffer = Buffer.from(actual, 'base64url');
    const expectedBuffer = Buffer.from(expected, 'base64url');
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function verifySignalControlEnvelope(appId: string, rawMessage: string) {
  const client = signalControlClients.get(appId);
  if (!client) return null;
  const envelope = JSON.parse(rawMessage) as {
    version?: number;
    sequence?: number;
    payload?: Record<string, unknown>;
    mac?: string;
  };
  const expectedSequence = client.receiveSequence + 1;
  if (envelope.version !== 1 || envelope.sequence !== expectedSequence || !envelope.payload) return null;
  const expectedMac = signalControlMac(client.key, [
    'maoyi-signal-control-message-v1',
    'signal-to-main',
    appId,
    client.processId,
    envelope.sequence,
    envelope.payload
  ]);
  if (!constantTimeBase64UrlEqual(envelope.mac, expectedMac)) return null;
  client.receiveSequence = expectedSequence;
  client.lastSeenAt = Date.now();
  return envelope.payload;
}

function sendSignalControlMessage(appId: string, payload: Record<string, unknown>) {
  const client = signalControlClients.get(appId);
  if (!client || client.socket.destroyed) return false;
  const sequence = client.sendSequence + 1;
  const envelope = {
    version: 1,
    sequence,
    payload,
    mac: signalControlMac(client.key, [
      'maoyi-signal-control-message-v1',
      'main-to-signal',
      appId,
      client.processId,
      sequence,
      payload
    ])
  };
  writeSignalWebSocketText(client.socket, JSON.stringify(envelope));
  client.sendSequence = sequence;
  return true;
}

function canShowSignalWindows() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
}

async function executeSignalScript(profileId: string, script: string) {
  const appId = signalAppId(profileId);
  const config = await readConfig();
  const profile = config.profiles.find((item) => item.id === profileId && item.platform === 'signal');
  if (!profile) throw new Error(`Signal profile ${profileId} was not found.`);
  if (!signalControlClients.has(appId)) {
    await launchSignalProfile(profileId);
  }

  return new Promise<unknown>((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      signalScriptRequests.delete(requestId);
      reject(new Error(`Signal script timed out for ${profile.name}.`));
    }, 8000);
    signalScriptRequests.set(requestId, { resolve, reject, timer });
    const sent = sendSignalControlMessage(appId, { type: 'script.execute', requestId, script });
    if (!sent) {
      clearTimeout(timer);
      signalScriptRequests.delete(requestId);
      reject(new Error(`Signal control channel is not connected for ${profile.name}.`));
    }
  });
}

function sendSignalWorkspaceBounds(profileId: string, bounds: SignalWorkspaceBounds) {
  pendingSignalWorkspaceBounds.set(profileId, bounds);
  const appId = signalAppId(profileId);
  const effectiveBounds = { ...bounds, visible: bounds.visible && canShowSignalWindows() };
  const screenBounds = signalBoundsToScreen(effectiveBounds);
  lastSignalScreenBounds.set(profileId, screenBounds);
  const sentBounds = sendSignalControlMessage(appId, {
    type: 'window.bounds-changed',
    bounds: screenBounds
  });
  const sentVisibility = sendSignalControlMessage(appId, {
    type: effectiveBounds.visible ? 'window.show' : 'window.hide',
    bounds: effectiveBounds.visible ? screenBounds : undefined
  });
  return sentBounds || sentVisibility;
}

function sameSignalScreenBounds(
  left: { x: number; y: number; width: number; height: number } | undefined,
  right: { x: number; y: number; width: number; height: number }
) {
  return Boolean(
    left &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height
  );
}

function syncVisibleSignalPosition(force = false) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) return;
  const profileId = visibleSignalProfileId;
  if (!profileId) return;
  const bounds = pendingSignalWorkspaceBounds.get(profileId);
  if (!bounds?.visible) return;
  const screenBounds = signalBoundsToScreen(bounds);
  if (!force && sameSignalScreenBounds(lastSignalScreenBounds.get(profileId), screenBounds)) return;
  lastSignalScreenBounds.set(profileId, screenBounds);
  sendSignalControlMessage(signalAppId(profileId), {
    type: 'window.bounds-changed',
    bounds: screenBounds
  });
}

function scheduleVisibleSignalMoveSync() {
  if (!signalMoveSyncTimer) {
    signalMoveSyncTimer = setTimeout(() => {
      signalMoveSyncTimer = null;
      syncVisibleSignalPosition();
    }, signalMoveSyncIntervalMs);
  }
  if (signalMoveFinalTimer) clearTimeout(signalMoveFinalTimer);
  signalMoveFinalTimer = setTimeout(() => {
    signalMoveFinalTimer = null;
    syncVisibleSignalPosition(true);
  }, signalMoveFinalDelayMs);
}

function scheduleSignalWorkspaceBounds(profileId: string, bounds: SignalWorkspaceBounds) {
  for (const delay of [0]) {
    setTimeout(() => {
      sendSignalWorkspaceBounds(profileId, bounds);
    }, delay);
  }
}

function signalBoundsToScreen(bounds: SignalWorkspaceBounds) {
  const contentBounds = mainWindow?.getContentBounds();
  const x = Math.max(0, Math.round((contentBounds?.x ?? 0) + bounds.x));
  const y = Math.max(0, Math.round((contentBounds?.y ?? 0) + bounds.y));
  const width = Math.max(320, Math.round(bounds.width));
  const height = Math.max(320, Math.round(bounds.height));
  return { x, y, width, height };
}

async function setSignalWorkspaceBounds(profileId: string, bounds: SignalWorkspaceBounds) {
  const config = await readConfig();
  const profile = config.profiles.find((item) => item.id === profileId && item.platform === 'signal');
  if (!profile) throw new Error(`Signal profile ${profileId} was not found.`);
  pendingSignalWorkspaceBounds.set(profileId, bounds);
  if (bounds.visible) visibleSignalProfileId = profileId;
  else if (visibleSignalProfileId === profileId) visibleSignalProfileId = null;
  if (bounds.visible && !canShowSignalWindows()) {
    sendSignalControlMessage(signalAppId(profileId), { type: 'window.hide' });
    return;
  }
  if (bounds.visible) {
    await launchSignalProfile(profileId);
  }
  scheduleSignalWorkspaceBounds(profileId, bounds);
}

async function hideSignalProfile(profileId: string) {
  pendingSignalWorkspaceBounds.delete(profileId);
  lastSignalScreenBounds.delete(profileId);
  if (visibleSignalProfileId === profileId) visibleSignalProfileId = null;
  sendSignalControlMessage(signalAppId(profileId), { type: 'window.hide' });
}

function hideAllSignalWindows() {
  for (const appId of signalControlClients.keys()) {
    sendSignalControlMessage(appId, { type: 'window.hide' });
  }
}

function cancelAppGroupBlurCheck() {
  if (!appGroupBlurTimer) return;
  clearTimeout(appGroupBlurTimer);
  appGroupBlurTimer = null;
}

function scheduleAppGroupBlurCheck() {
  cancelAppGroupBlurCheck();
  appGroupBlurTimer = setTimeout(() => {
    appGroupBlurTimer = null;
    if (mainWindow?.isFocused() || focusedSignalProfileId) return;
    hideAllSignalWindows();
  }, appGroupBlurDelayMs);
}

async function hideAllConfiguredSignalProfiles() {
  hideAllSignalWindows();
  const config = await readConfig();
  await Promise.all(
    config.profiles
      .filter((profile) => profile.platform === 'signal')
      .map((profile) => hideSignalProfile(profile.id))
  );
  hideAllSignalWindows();
}

function resyncVisibleSignalWindows() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || !mainWindow.isVisible()) {
    hideAllSignalWindows();
    return;
  }

  for (const [profileId, bounds] of pendingSignalWorkspaceBounds.entries()) {
    if (bounds.visible) sendSignalWorkspaceBounds(profileId, bounds);
  }
}

function requestSignalWorkspaceSyncBurst() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  for (const delay of [0]) {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('signal:sync-workspace');
      resyncVisibleSignalWindows();
    }, delay);
  }
}

function handleSignalControlMessage(appId: string, message: Record<string, unknown>) {
  const client = signalControlClients.get(appId);
  if (client) client.lastSeenAt = Date.now();

  try {
    if (message.type === 'window.group-focused') {
      focusedSignalProfileId = profileIdFromSignalAppId(appId);
      cancelAppGroupBlurCheck();
    }
    if (message.type === 'window.group-blurred') {
      const profileId = profileIdFromSignalAppId(appId);
      if (focusedSignalProfileId === profileId) focusedSignalProfileId = null;
      scheduleAppGroupBlurCheck();
    }
    if (message.type === 'heartbeat') {
      sendSignalControlMessage(appId, { type: 'heartbeat.ack', at: Date.now() });
    }
    if (message.type === 'ready') {
      const profileId = profileIdFromSignalAppId(appId);
      const bounds = pendingSignalWorkspaceBounds.get(profileId);
      if (bounds) sendSignalWorkspaceBounds(profileId, bounds);
    }
    if (message.type === 'script.result' && typeof message.requestId === 'string') {
      const request = signalScriptRequests.get(message.requestId);
      if (request) {
        clearTimeout(request.timer);
        signalScriptRequests.delete(message.requestId);
        request.resolve(message.result);
      }
    }
    if (message.type === 'error' && typeof message.requestId === 'string') {
      const request = signalScriptRequests.get(message.requestId);
      if (request) {
        clearTimeout(request.timer);
        signalScriptRequests.delete(message.requestId);
        request.reject(new Error(typeof message.message === 'string' ? message.message : 'Signal script failed.'));
      }
    }
  } catch {
    // Ignore malformed child-process messages. The channel must keep running.
  }

  void persistSignalControlStatus();
}

async function persistSignalControlStatus() {
  if (!runtimeLoggingEnabled) return;
  const entries = Array.from(signalControlClients.entries()).map(([appId, client]) => ({
    appId,
    processId: client.processId,
    connected: !client.socket.destroyed,
    connectedAt: client.connectedAt,
    lastSeenAt: client.lastSeenAt
  }));
  try {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeJsonAtomic(signalControlStatusPath(), { port: signalControlPort, entries, updatedAt: Date.now() });
  } catch {
    // Diagnostics must not block Signal runtime control.
  }
}

async function cleanupPackagedRuntimeLogs() {
  if (runtimeLoggingEnabled) return;
  const userDataPath = app.getPath('userData');
  const directLogFiles = [
    translateRequestLogPath(),
    signalTranslationDebugLogPath(),
    signalControlStatusPath(),
    join(userDataPath, 'protocol-handlers.log')
  ];
  await Promise.all(directLogFiles.map((path) => rm(path, { force: true }).catch(() => undefined)));

  try {
    const entries = await readdir(userDataPath, { withFileTypes: true });
    await Promise.all(entries
      .filter((entry) => entry.isFile() && /^signal-control-status\..+\.tmp$/i.test(entry.name))
      .map((entry) => rm(join(userDataPath, entry.name), { force: true }).catch(() => undefined)));
  } catch {
    // The user data directory may not exist on first launch.
  }

  try {
    const instances = await readdir(signalInstancesRoot(), { withFileTypes: true });
    await Promise.all(instances
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const instanceDir = join(signalInstancesRoot(), entry.name);
        return [
          rm(join(instanceDir, 'logs'), { recursive: true, force: true }).catch(() => undefined),
          rm(join(instanceDir, 'protocol-handlers.log'), { force: true }).catch(() => undefined)
        ];
      }));
  } catch {
    // Signal instances are created lazily.
  }
}

async function launchSignalProfile(id: string) {
  const activeLaunch = signalLaunchPromises.get(id);
  if (activeLaunch) return activeLaunch;
  const launchPromise = launchSignalProfileNow(id).finally(() => {
    if (signalLaunchPromises.get(id) === launchPromise) {
      signalLaunchPromises.delete(id);
    }
  });
  signalLaunchPromises.set(id, launchPromise);
  return launchPromise;
}

type SignalCredentialPipe = {
  address: string;
  deliver: (credential: ReturnType<typeof createSignalLaunchCredential>) => Promise<void>;
  close: () => Promise<void>;
};

async function closeNetServer(server: NetServer) {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

async function createSignalCredentialPipe(): Promise<SignalCredentialPipe> {
  if (process.platform !== 'win32') throw new Error('Signal launch credential pipes require Windows.');
  const address = `\\\\.\\pipe\\maoyi-signal-${process.pid}-${randomBytes(16).toString('hex')}`;
  let claimed = false;
  let credentialResolve: ((value: string) => void) | null = null;
  const credentialReady = new Promise<string>((resolvePromise) => {
    credentialResolve = resolvePromise;
  });
  let deliveryResolve: (() => void) | null = null;
  let deliveryReject: ((error: Error) => void) | null = null;
  const delivered = new Promise<void>((resolvePromise, reject) => {
    deliveryResolve = resolvePromise;
    deliveryReject = reject;
  });
  const server = createNetServer((socket) => {
    if (claimed) {
      socket.destroy();
      return;
    }
    claimed = true;
    socket.once('error', (error) => deliveryReject?.(error));
    void credentialReady.then((payload) => {
      socket.end(payload, () => deliveryResolve?.());
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(address, () => {
      server.off('error', onError);
      resolvePromise();
    });
  });
  return {
    address,
    async deliver(credential) {
      credentialResolve?.(`${JSON.stringify(credential)}\n`);
      credentialResolve = null;
      let timer: NodeJS.Timeout | null = null;
      try {
        await Promise.race([
          delivered,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Signal launch credential pipe timed out.')), 10_000);
          })
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    close: () => closeNetServer(server)
  };
}

async function launchSignalProfileNow(id: string) {
  assertClientRuntimeAllowed();
  const runtimeSecurity = activeRuntimeSecurity;
  if (!runtimeSecurity) throw new Error('Signal 运行时绑定尚未建立');
  const runtimeBinding = runtimeSecurity.payload;
  const config = await readConfig();
  const profile = config.profiles.find((item) => item.id === id && item.platform === 'signal');
  if (!profile) throw new Error(`Signal profile ${id} was not found.`);
  const dataDir = profile.signalDataDir || signalInstancePath(profile.id);
  let recovered = false;
  if (await hasSignalStartupCorruption(dataDir)) {
    await killSignalProcessesByDataDir(dataDir);
    const existingCorruptProcess = signalProcesses.get(id);
    if (existingCorruptProcess) {
      signalProcesses.delete(id);
      if (existingCorruptProcess.exitCode === null && !existingCorruptProcess.killed) {
        existingCorruptProcess.kill();
      }
    }
    recovered = await quarantineSignalDataDir(dataDir);
  }

  const existingProcess = signalProcesses.get(id);
  if (existingProcess && existingProcess.exitCode === null && !existingProcess.killed) {
    scheduleHideSignalTaskbarButtons(dataDir);
    return { pid: existingProcess.pid ?? null, dataDir, recovered };
  }

  await mkdir(dataDir, { recursive: true });
  await ensureSignalInstanceBinding(
    dataDir,
    profile.id,
    runtimeBinding,
    runtimeSecurity.devicePrivateKeyPem
  );
  await ensureSignalRuntimePreferences(dataDir);
  await cleanupSignalUpdateArtifacts(dataDir);

  const executable = await resolveSignalExecutable();
  const wsPort = await ensureSignalControlServer();
  const credentialPipe = await createSignalCredentialPipe();
  const args = [
    '--df',
    `--user-data-dir=${dataDir}`,
    `--appId=${signalAppId(profile.id)}`,
    `--wsPort=${wsPort}`,
    `--dfLaunchPipe=${credentialPipe.address}`,
    '--windowMode=embed',
    `--title=${profile.name}`
  ];
  const child = spawn(executable, args, {
    stdio: 'ignore',
    windowsHide: false,
    env: runtimeLoggingEnabled
      ? {
          ...process.env,
          MAOYI_SIGNAL_GUARD_DIAGNOSTIC: join(dataDir, 'df-guard-debug.json')
        }
      : undefined
  });
  child.once('exit', () => {
    if (signalProcesses.get(id) === child) {
      signalProcesses.delete(id);
    }
    const appId = signalAppId(id);
    const controlSession = signalControlSessions.get(appId);
    if (controlSession?.processId === child.pid) {
      signalControlSessions.delete(appId);
      signalControlClients.get(appId)?.socket.destroy();
      signalControlClients.delete(appId);
    }
  });
  if (!child.pid) {
    child.kill();
    await credentialPipe.close();
    throw new Error('Signal process did not receive a process ID.');
  }
  const credential = createSignalLaunchCredential(
    runtimeBinding,
    profile.id,
    child.pid,
    runtimeSecurity.devicePrivateKeyPem
  );
  signalControlSessions.set(signalAppId(profile.id), {
    processId: child.pid,
    key: Buffer.from(credential.controlKey, 'base64url'),
    createdAt: Date.now()
  });
  try {
    await credentialPipe.deliver(credential);
  } catch (error) {
    signalControlSessions.delete(signalAppId(profile.id));
    child.kill();
    throw error;
  } finally {
    await credentialPipe.close();
  }
  signalProcesses.set(id, child);
  scheduleHideSignalTaskbarButtons(dataDir);
  scheduleSignalStartupRecovery(profile.id, dataDir);
  return { pid: child.pid ?? null, dataDir, wsPort, recovered };
}

function scheduleSignalStartupRecovery(profileId: string, dataDir: string) {
  for (const delay of [3500, 9000]) {
    setTimeout(() => {
      void recoverSignalStartupIfCorrupt(profileId, dataDir);
    }, delay);
  }
}

async function recoverSignalStartupIfCorrupt(profileId: string, dataDir: string) {
  if (signalStartupRecoveryAttempts.has(profileId)) return;
  if (!(await hasSignalStartupCorruption(dataDir))) return;

  signalStartupRecoveryAttempts.add(profileId);
  await killSignalProcessesByDataDir(dataDir);
  const child = signalProcesses.get(profileId);
  if (child) {
    signalProcesses.delete(profileId);
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
  const recovered = await quarantineSignalDataDir(dataDir);
  if (!recovered) return;

  const bounds = pendingSignalWorkspaceBounds.get(profileId);
  if (bounds?.visible) {
    await launchSignalProfile(profileId);
    sendSignalWorkspaceBounds(profileId, bounds);
  }
}

function scheduleHideSignalTaskbarButtons(dataDir: string) {
  void dataDir;
}

function scheduleHideConfiguredSignalTaskbarButtons(config: AppConfig) {
  if (process.platform !== 'win32') return;
  const dataDirs = config.profiles
    .filter((profile) => profile.platform === 'signal')
    .map((profile) => profile.signalDataDir || signalInstancePath(profile.id));
  for (const dataDir of dataDirs) {
    scheduleHideSignalTaskbarButtons(dataDir);
  }
}

async function stopSignalProfile(id: string, signalDataDir?: string) {
  assertProfileId(id);
  const appId = signalAppId(id);
  signalControlSessions.delete(appId);
  signalControlClients.get(appId)?.socket.destroy();
  signalControlClients.delete(appId);
  const child = signalProcesses.get(id);
  if (child) {
    signalProcesses.delete(id);
  }
  if (child && child.exitCode === null && !child.killed) {
    child.kill();
  }

  let dataDir = signalDataDir;
  if (!dataDir) {
    const config = await readConfig();
    const profile = config.profiles.find((item) => item.id === id && item.platform === 'signal');
    dataDir = profile?.signalDataDir;
  }
  if (dataDir) {
    await killSignalProcessesByDataDir(dataDir);
  }
}

async function killSignalProcessesByDataDir(dataDir: string) {
  if (process.platform !== 'win32') return;
  const safeDataDir = resolve(dataDir);
  const child = relative(resolve(signalInstancesRoot()), safeDataDir);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Signal data directory escaped its authorized root.');
  }
  const escaped = safeDataDir.replace(/'/g, "''");
  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    `$needle = '${escaped}'`,
    "Get-CimInstance Win32_Process -Filter \"Name = 'Signal.exe'\" |",
    '  Where-Object { $_.CommandLine -like "*$needle*" } |',
    '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
  ].join('\n');
  await new Promise<void>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true }, () => {
      resolve();
    });
  });
}

async function stopAllSignalProfilesForQuit() {
  for (const child of signalProcesses.values()) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
  signalProcesses.clear();
  for (const client of signalControlClients.values()) client.socket.destroy();
  signalControlClients.clear();
  signalControlSessions.clear();

  const config = await readConfig();
  const dataDirs = config.profiles
    .filter((profile) => profile.platform === 'signal')
    .map((profile) => profile.signalDataDir || signalInstancePath(profile.id));

  await Promise.all(dataDirs.map((dataDir) => killSignalProcessesByDataDir(dataDir)));
}

async function renameProfile(id: string, name: string, group: string): Promise<AppConfig> {
  const nextName = name.trim();
  const nextGroup = group.trim();
  if (!id || !nextName) throw new Error('Profile name is required.');
  if (!nextGroup) throw new Error('Profile group is required.');
  const config = await readConfig();
  const profile = config.profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`Profile ${id} was not found.`);
  if (profile.name === nextName && profile.group === nextGroup) return config;
  const duplicate = config.profiles.some((item) => item.id !== id && item.platform === profile.platform && item.name === nextName);
  if (duplicate) throw new Error(`Profile name ${nextName} already exists.`);
  profile.name = nextName;
  profile.group = nextGroup;
  return saveConfig(config);
}

async function removeProfile(id: string): Promise<AppConfig> {
  const config = await readConfig();
  const profile = config.profiles.find((item) => item.id === id);
  config.profiles = config.profiles.filter((profile) => profile.id !== id);
  if (config.activeProfileId === id) {
    config.activeProfileId = config.profiles[0]?.id ?? null;
  }
  const savedConfig = await saveConfig(config);
  if (profile) {
    if (profile.platform === 'signal') {
      await stopSignalProfile(profile.id, profile.signalDataDir);
    }
    await destroyProfilePartition(profile.partition);
    await removeProfileTranslationCache(profile.id);
    if (profile.signalDataDir) {
      await removePathWithRetry(profile.signalDataDir);
    }
  }
  await cleanupOrphanProfilePartitions(savedConfig);
  await cleanupOrphanSignalInstances(savedConfig);
  return savedConfig;
}

async function removeProfileTranslationCache(profileId: string) {
  const safeProfileId = safeProfileFileName(profileId);
  for (const platform of supportedPlatforms) {
    const platformRoot = containedPath(translationCacheRoot(), 'v3', safePathPart(platform));
    await removePathWithRetry(containedPath(platformRoot, safeProfileId));
  }
}

async function readTranslationCacheIndex(request: TranslationCacheLoadRequest | TranslationCacheSetRequest): Promise<TranslationCacheIndex> {
  try {
    const raw = (await readFile(chunkedTranslationCacheIndexPath(request), 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as Partial<TranslationCacheIndex>;
    if (parsed.schemaVersion !== 3 || !Array.isArray(parsed.chunks)) return defaultTranslationCacheIndex();
    return {
      schemaVersion: 3,
      updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt as number : Date.now(),
      chunks: parsed.chunks
        .filter((chunk): chunk is TranslationCacheChunkMeta =>
          Boolean(
            /^chunk-\d{6}\.dfc$/.test(chunk?.file || '') &&
            Number.isFinite(chunk.count) &&
            Number.isFinite(chunk.bytes) &&
            Number.isFinite(chunk.minUpdatedAt) &&
            Number.isFinite(chunk.maxUpdatedAt)
          )
        ),
      oldestViewedKey: parsed.oldestViewedKey,
      oldestViewedAt: parsed.oldestViewedAt,
      lastViewedRange: parsed.lastViewedRange
    };
  } catch {
    return defaultTranslationCacheIndex();
  }
}

async function readTranslationCacheIndexFromDir(cacheDir: string): Promise<TranslationCacheIndex> {
  try {
    const raw = (await readFile(containedPath(cacheDir, 'index.json'), 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw) as Partial<TranslationCacheIndex>;
    if (parsed.schemaVersion !== 3 || !Array.isArray(parsed.chunks)) return defaultTranslationCacheIndex();
    return {
      schemaVersion: 3,
      updatedAt: Number.isFinite(parsed.updatedAt) ? parsed.updatedAt as number : Date.now(),
      chunks: parsed.chunks
        .filter((chunk): chunk is TranslationCacheChunkMeta =>
          Boolean(
            /^chunk-\d{6}\.dfc$/.test(chunk?.file || '') &&
            Number.isFinite(chunk.count) &&
            Number.isFinite(chunk.bytes) &&
            Number.isFinite(chunk.minUpdatedAt) &&
            Number.isFinite(chunk.maxUpdatedAt)
          )
        ),
      oldestViewedKey: parsed.oldestViewedKey,
      oldestViewedAt: parsed.oldestViewedAt,
      lastViewedRange: parsed.lastViewedRange
    };
  } catch {
    return defaultTranslationCacheIndex();
  }
}

async function writeTranslationCacheIndex(request: TranslationCacheLoadRequest | TranslationCacheSetRequest, index: TranslationCacheIndex) {
  const targetPath = chunkedTranslationCacheIndexPath(request);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeJsonAtomic(targetPath, { ...index, updatedAt: Date.now() });
}

async function readTranslationCacheChunk(request: TranslationCacheLoadRequest | TranslationCacheSetRequest, chunk: TranslationCacheChunkMeta) {
  const cacheDir = chunkedTranslationCacheDir(request);
  try {
    const raw = await readFile(containedPath(cacheDir, chunk.file), 'utf8');
    return decryptTranslationCacheChunk(cacheDir, chunk.file, raw);
  } catch {
    return [];
  }
}

async function readTranslationCacheChunkFromDir(cacheDir: string, chunk: TranslationCacheChunkMeta) {
  try {
    const raw = await readFile(containedPath(cacheDir, chunk.file), 'utf8');
    return decryptTranslationCacheChunk(cacheDir, chunk.file, raw);
  } catch {
    return [];
  }
}

function decryptTranslationCacheChunk(cacheDir: string, chunkFile: string, raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return decryptTranslationCacheEntry(
          cacheDir,
          chunkFile,
          JSON.parse(line) as EncryptedTranslationCacheRecord
        );
      } catch {
        return null;
      }
    })
    .filter((entry): entry is TranslationCacheEntry =>
      Boolean(entry?.sourceHash && entry?.translatedText && Number.isFinite(entry?.updatedAt))
    );
}

function mergeTranslationCacheEntries(entries: TranslationCacheEntry[]) {
  const byHash = new Map<string, TranslationCacheEntry>();
  for (const entry of entries.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!byHash.has(entry.sourceHash)) byHash.set(entry.sourceHash, entry);
  }
  return Array.from(byHash.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readChunkedTranslationCacheEntries(
  request: TranslationCacheLoadRequest | TranslationCacheSetRequest,
  neededCount: number
) {
  const index = await readTranslationCacheIndex(request);
  if (!index.chunks.length) return [];
  const entries: TranslationCacheEntry[] = [];
  const chunksNewestFirst = [...index.chunks].sort((a, b) => b.maxUpdatedAt - a.maxUpdatedAt);
  for (const chunk of chunksNewestFirst) {
    entries.push(...await readTranslationCacheChunk(request, chunk));
    if (mergeTranslationCacheEntries(entries).length >= neededCount) break;
  }
  return mergeTranslationCacheEntries(entries);
}

async function readChunkedTranslationCacheEntriesFromDir(cacheDir: string, neededCount: number) {
  const index = await readTranslationCacheIndexFromDir(cacheDir);
  if (!index.chunks.length) return [];
  const entries: TranslationCacheEntry[] = [];
  const chunksNewestFirst = [...index.chunks].sort((a, b) => b.maxUpdatedAt - a.maxUpdatedAt);
  for (const chunk of chunksNewestFirst) {
    entries.push(...await readTranslationCacheChunkFromDir(cacheDir, chunk));
    if (mergeTranslationCacheEntries(entries).length >= neededCount) break;
  }
  return mergeTranslationCacheEntries(entries);
}

function requestedTranslationSourceHashes(request: TranslationCacheLookupRequest) {
  return Array.from(
    new Set(
      (request.sourceHashes || [])
        .map((hash) => String(hash || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 240);
}

function collectMatchingTranslationEntries(
  entries: TranslationCacheEntry[],
  requestedHashes: Set<string>,
  matchedEntries: Map<string, TranslationCacheEntry>
) {
  for (const entry of entries.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!requestedHashes.has(entry.sourceHash) || matchedEntries.has(entry.sourceHash)) continue;
    matchedEntries.set(entry.sourceHash, entry);
  }
}

async function readChunkedTranslationCacheEntriesByHashes(
  request: TranslationCacheLoadRequest | TranslationCacheSetRequest,
  sourceHashes: string[]
) {
  const requestedHashes = new Set(sourceHashes);
  const matchedEntries = new Map<string, TranslationCacheEntry>();
  const index = await readTranslationCacheIndex(request);
  const chunksNewestFirst = [...index.chunks].sort((a, b) => b.maxUpdatedAt - a.maxUpdatedAt);
  for (const chunk of chunksNewestFirst) {
    collectMatchingTranslationEntries(await readTranslationCacheChunk(request, chunk), requestedHashes, matchedEntries);
    if (matchedEntries.size >= requestedHashes.size) break;
  }
  return Array.from(matchedEntries.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readChunkedTranslationCacheEntriesFromDirByHashes(cacheDir: string, sourceHashes: string[]) {
  const requestedHashes = new Set(sourceHashes);
  const matchedEntries = new Map<string, TranslationCacheEntry>();
  const index = await readTranslationCacheIndexFromDir(cacheDir);
  const chunksNewestFirst = [...index.chunks].sort((a, b) => b.maxUpdatedAt - a.maxUpdatedAt);
  for (const chunk of chunksNewestFirst) {
    collectMatchingTranslationEntries(await readTranslationCacheChunkFromDir(cacheDir, chunk), requestedHashes, matchedEntries);
    if (matchedEntries.size >= requestedHashes.size) break;
  }
  return Array.from(matchedEntries.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function listDirectoryPaths(path: string) {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(path, entry.name));
  } catch {
    return [];
  }
}

async function readProfileWideChunkedTranslationCacheEntries(profileId: string, neededCount: number) {
  const cacheDirs: string[] = [];
  for (const platformDir of await listDirectoryPaths(join(translationCacheRoot(), 'v3'))) {
    const profileDir = join(platformDir, safeProfileFileName(profileId));
    cacheDirs.push(...await listDirectoryPaths(profileDir));
  }

  const indexedCacheDirs: Array<{ cacheDir: string; index: TranslationCacheIndex }> = [];
  for (const cacheDir of cacheDirs) {
    const index = await readTranslationCacheIndexFromDir(cacheDir);
    if (index.chunks.length) indexedCacheDirs.push({ cacheDir, index });
  }

  const entries: TranslationCacheEntry[] = [];
  for (const { cacheDir } of indexedCacheDirs.sort((a, b) => b.index.updatedAt - a.index.updatedAt)) {
    entries.push(...await readChunkedTranslationCacheEntriesFromDir(cacheDir, neededCount));
    if (mergeTranslationCacheEntries(entries).length >= neededCount) break;
  }
  return mergeTranslationCacheEntries(entries);
}

async function readProfileWideChunkedTranslationCacheEntriesByHashes(profileId: string, sourceHashes: string[]) {
  const requestedHashes = new Set(sourceHashes);
  const matchedEntries = new Map<string, TranslationCacheEntry>();
  const cacheDirs: string[] = [];
  for (const platformDir of await listDirectoryPaths(join(translationCacheRoot(), 'v3'))) {
    const profileDir = join(platformDir, safeProfileFileName(profileId));
    cacheDirs.push(...await listDirectoryPaths(profileDir));
  }

  const indexedCacheDirs: Array<{ cacheDir: string; index: TranslationCacheIndex }> = [];
  for (const cacheDir of cacheDirs) {
    const index = await readTranslationCacheIndexFromDir(cacheDir);
    if (index.chunks.length) indexedCacheDirs.push({ cacheDir, index });
  }

  for (const { cacheDir } of indexedCacheDirs.sort((a, b) => b.index.updatedAt - a.index.updatedAt)) {
    const missingHashes = sourceHashes.filter((hash) => !matchedEntries.has(hash));
    if (!missingHashes.length) break;
    collectMatchingTranslationEntries(
      await readChunkedTranslationCacheEntriesFromDirByHashes(cacheDir, missingHashes),
      requestedHashes,
      matchedEntries
    );
  }
  return Array.from(matchedEntries.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function loadTranslationCache(request: TranslationCacheLoadRequest): Promise<TranslationCacheEntry[]> {
  const offset = Math.max(0, request.offset ?? 0);
  const limit = Math.min(Math.max(1, request.limit ?? 100), 1000);
  const neededCount = offset + limit;
  const chunkedEntries = request.platform || request.contactId
    ? await readChunkedTranslationCacheEntries(request, neededCount)
    : await readProfileWideChunkedTranslationCacheEntries(request.profileId, neededCount);
  const entries = mergeTranslationCacheEntries(chunkedEntries);
  return entries.slice(offset, offset + limit);
}

async function lookupTranslationCache(request: TranslationCacheLookupRequest): Promise<TranslationCacheEntry[]> {
  const sourceHashes = requestedTranslationSourceHashes(request);
  if (!request.profileId || !sourceHashes.length) return [];

  const scopedEntries = request.platform || request.contactId
    ? await readChunkedTranslationCacheEntriesByHashes(request, sourceHashes)
    : [];
  const scopedMatches = mergeTranslationCacheEntries(scopedEntries);
  const scopedMatchedHashes = new Set(scopedMatches.map((entry) => entry.sourceHash));
  const missingHashes = sourceHashes.filter((hash) => !scopedMatchedHashes.has(hash));
  const profileEntries = missingHashes.length
    ? await readProfileWideChunkedTranslationCacheEntriesByHashes(request.profileId, missingHashes)
    : [];
  return mergeTranslationCacheEntries([
    ...scopedMatches,
    ...profileEntries
  ]);
}

function translationCacheWriteQueueKey(request: TranslationCacheSetRequest) {
  return chunkedTranslationCacheDir(request);
}

async function saveTranslationCacheEntry(request: TranslationCacheSetRequest): Promise<void> {
  if (!request.profileId || !request.sourceHash || !request.translatedText || !isEnglishChatSource(request.sourceText)) return;
  if (await isMarkedNonEnglishContact(request)) return;
  const queueKey = translationCacheWriteQueueKey(request);
  const previousWrite = translationCacheWriteQueues.get(queueKey) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(() => saveTranslationCacheEntryNow(request));
  translationCacheWriteQueues.set(queueKey, nextWrite);
  try {
    await nextWrite;
  } finally {
    if (translationCacheWriteQueues.get(queueKey) === nextWrite) {
      translationCacheWriteQueues.delete(queueKey);
    }
  }
}

async function saveTranslationCacheEntryNow(request: TranslationCacheSetRequest): Promise<void> {
  const nextEntry: TranslationCacheEntry = {
    sourceHash: request.sourceHash,
    sourceText: request.sourceText,
    translatedText: request.translatedText,
    platform: request.platform,
    profileId: request.profileId,
    profileName: request.profileName,
    contactId: request.contactId,
    contactIdType: request.contactIdType,
    contactTitle: request.contactTitle,
    contactRemark: request.contactRemark,
    direction: request.direction,
    timestamp: request.timestamp,
    messagePart: request.messagePart,
    updatedAt: Date.now()
  };
  const targetDir = chunkedTranslationCacheDir(request);
  const index = await readTranslationCacheIndex(request);
  let currentChunk = index.chunks[index.chunks.length - 1];
  if (
    !currentChunk ||
    currentChunk.count >= translationCacheChunkRecordLimit ||
    currentChunk.bytes >= translationCacheChunkByteLimit
  ) {
    currentChunk = {
      file: `chunk-${String(index.chunks.length + 1).padStart(6, '0')}.dfc`,
      count: 0,
      bytes: 0,
      minUpdatedAt: nextEntry.updatedAt,
      maxUpdatedAt: nextEntry.updatedAt
    };
    index.chunks.push(currentChunk);
  }
  await mkdir(targetDir, { recursive: true });
  let encryptedLine = `${JSON.stringify(encryptTranslationCacheEntry(targetDir, currentChunk.file, nextEntry))}\n`;
  let lineBytes = Buffer.byteLength(encryptedLine, 'utf8');
  if (currentChunk.count > 0 && currentChunk.bytes + lineBytes > translationCacheChunkByteLimit) {
    currentChunk = {
      file: `chunk-${String(index.chunks.length + 1).padStart(6, '0')}.dfc`,
      count: 0,
      bytes: 0,
      minUpdatedAt: nextEntry.updatedAt,
      maxUpdatedAt: nextEntry.updatedAt
    };
    index.chunks.push(currentChunk);
    encryptedLine = `${JSON.stringify(encryptTranslationCacheEntry(targetDir, currentChunk.file, nextEntry))}\n`;
    lineBytes = Buffer.byteLength(encryptedLine, 'utf8');
  }
  await appendFile(containedPath(targetDir, currentChunk.file), encryptedLine, 'utf8');
  currentChunk.count += 1;
  currentChunk.bytes += lineBytes;
  currentChunk.minUpdatedAt = Math.min(currentChunk.minUpdatedAt, nextEntry.updatedAt);
  currentChunk.maxUpdatedAt = Math.max(currentChunk.maxUpdatedAt, nextEntry.updatedAt);
  await writeTranslationCacheIndex(request, index);
}

async function destroyProfilePartition(partition: string) {
  const storagePath = partitionStoragePath(partition);
  if (!storagePath) throw new Error('Profile partition is invalid.');
  const ses = session.fromPartition(partition);

  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed() || contents.session !== ses) continue;
    contents.close({ waitForBeforeUnload: false });
  }

  await ses.clearStorageData();
  await ses.clearCache();
  await ses.closeAllConnections();
  ses.flushStorageData();

  await removePathWithRetry(storagePath);

  configuredPartitions.delete(partition);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removePathWithRetry(path: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      return;
    } catch (error) {
      lastError = error;
      await wait(250 + attempt * 250);
    }
  }

  throw lastError;
}

async function cleanupOrphanProfilePartitions(config: AppConfig) {
  const partitionsRoot = join(app.getPath('userData'), 'Partitions');
  const activePartitionNames = new Set(
    config.profiles
      .map((profile) => (profile.partition.startsWith('persist:') ? profile.partition.slice('persist:'.length) : null))
      .filter((partitionName): partitionName is string => Boolean(partitionName))
  );

  let partitionDirs: string[];
  try {
    partitionDirs = await readdir(partitionsRoot);
  } catch {
    return;
  }

  await Promise.all(
    partitionDirs
      .filter((partitionName) => /^chat-[0-9a-f-]{36}$/i.test(partitionName) && !activePartitionNames.has(partitionName))
      .map((partitionName) => removePathWithRetry(containedPath(partitionsRoot, partitionName)))
  );
}

async function ensureSignalInstanceDirs(config: AppConfig) {
  await Promise.all(
    config.profiles
      .filter((profile) => profile.platform === 'signal' && profile.signalDataDir)
      .map((profile) => mkdir(profile.signalDataDir as string, { recursive: true }))
  );
}

async function ensureSignalProfileBindings(
  config: AppConfig,
  runtimeBinding: RuntimeBindingPayload,
  devicePrivateKeyPem: string
) {
  await Promise.all(
    config.profiles
      .filter((profile) => profile.platform === 'signal' && profile.signalDataDir)
      .map((profile) => ensureSignalInstanceBinding(
        profile.signalDataDir as string,
        profile.id,
        runtimeBinding,
        devicePrivateKeyPem
      ))
  );
}

async function cleanupOrphanSignalInstances(config: AppConfig) {
  const activeSignalDirs = new Set(
    config.profiles
      .filter((profile) => profile.platform === 'signal' && profile.signalDataDir)
      .map((profile) => profile.signalDataDir)
  );

  let signalDirs: string[];
  try {
    signalDirs = await readdir(signalInstancesRoot());
  } catch {
    return;
  }

  await Promise.all(
    signalDirs
      .filter((dirName) => /^Signal-[0-9a-f-]{36}(?:\.broken-.+)?$/i.test(dirName))
      .map((dirName) => containedPath(signalInstancesRoot(), dirName))
      .filter((dirPath) => !activeSignalDirs.has(dirPath))
      .map(async (dirPath) => {
        await killSignalProcessesByDataDir(dirPath);
        await removePathWithRetry(dirPath);
      })
  );
}

function canonicalSendText(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').normalize('NFC').trim();
}

function registerApprovedComposerTranslation(request: TranslateRequest, requestId: string, translatedText: string) {
  if (!request.profileId || !request.platform || !['composer-enter', 'composer-pretranslate'].includes(request.reason || '')) return;
  const now = Date.now();
  for (const [key, entry] of approvedComposerTranslations) {
    if (entry.expiresAt <= now) approvedComposerTranslations.delete(key);
  }
  approvedComposerTranslations.set(requestId, {
    profileId: request.profileId,
    platform: request.platform,
    conversationSignature: canonicalSendText(request.contactId || ''),
    textHash: createHash('sha256').update(canonicalSendText(translatedText)).digest('hex'),
    expiresAt: now + approvedComposerTranslationTtlMs
  });
}

function authorizeTranslatedSend(request: SendAuthorizationRequest) {
  const approval = approvedComposerTranslations.get(request.requestId);
  if (!approval) return { ok: false, reason: '翻译发送凭证不存在或已使用' };
  approvedComposerTranslations.delete(request.requestId);
  if (approval.expiresAt < Date.now()) return { ok: false, reason: '翻译发送凭证已过期，请重新翻译' };
  const textHash = createHash('sha256').update(canonicalSendText(request.text)).digest('hex');
  if (
    approval.profileId !== request.profileId ||
    approval.platform !== request.platform ||
    approval.conversationSignature !== canonicalSendText(request.conversationSignature || '') ||
    approval.textHash !== textHash
  ) return { ok: false, reason: '发送内容、联系人或多开与翻译结果不一致，已阻止发送' };
  return { ok: true };
}

async function assertSensitiveSendProfile(request: SensitiveSendRequest) {
  const profile = (await readConfig()).profiles.find((item) => item.id === request.profileId);
  if (!profile || profile.platform !== request.platform) throw new Error('当前多开与发送平台不一致');
  if (!request.conversationSignature.trim()) throw new Error('未识别当前联系人，已阻止发送');
  return profile;
}

async function prepareSensitiveSend(request: SensitiveSendPrepareRequest) {
  const profile = await assertSensitiveSendProfile(request);
  const inspection = inspectSensitiveSendText(request.text);
  if (!inspection.candidate || !inspection.valid || !inspection.kind) {
    return { ok: false, reason: inspection.reason || '该内容不是可确认的收款账号或 USDT 地址' };
  }
  let network: WalletNetwork | undefined;
  const networkChoices = inspection.networks || [];
  const contact = request.conversationSignature.split('::')[0].split('|')[0].trim().slice(0, 120) || '未命名联系人';
  const platformName = platformDefaults[request.platform].label;
  const confirmationMessage = [
    `平台及多开：${platformName} · ${profile.name}`,
    `联系人：${contact}`,
    inspection.kind === 'numeric-account' ? '类型：单一数字收款账号' : '类型：USDT 钱包地址',
    `完整内容：${request.text}`,
    inspection.kind === 'usdt-wallet' && networkChoices.length === 1 ? `网络：${networkChoices[0]}` : '',
    '确认后不会立即发送，请返回聊天窗口再次按回车。'
  ].filter(Boolean).join('\n\n');
  const buttons = inspection.kind === 'usdt-wallet' && networkChoices.length > 1
    ? [...networkChoices, '取消']
    : ['锁定，等待第二次回车', '取消'];
  const cancelId = buttons.length - 1;
  if (request.platform === 'signal') hideAllSignalWindows();
  let response: number;
  try {
    const options = {
      type: 'warning' as const,
      title: '发送前可信确认',
      message: inspection.kind === 'numeric-account' ? '确认收款账号' : '确认 USDT 地址与网络',
      detail: confirmationMessage,
      buttons,
      defaultId: 0,
      cancelId,
      noLink: true
    };
    response = mainWindow
      ? (await dialog.showMessageBox(mainWindow, options)).response
      : (await dialog.showMessageBox(options)).response;
  } finally {
    if (request.platform === 'signal') requestSignalWorkspaceSyncBurst();
  }
  if (response === cancelId) return { ok: false, reason: '已取消敏感信息发送确认' };
  if (inspection.kind === 'usdt-wallet') network = networkChoices.length > 1
    ? networkChoices[response]
    : networkChoices[0];
  if (inspection.kind === 'usdt-wallet' && !isAllowedWalletNetwork(inspection, network)) {
    return { ok: false, reason: '钱包网络未确认或与地址格式不一致' };
  }

  const { token, expiresAt } = sensitiveSendAuthorizations.issue(request, inspection.kind, network);
  return { ok: true, token, kind: inspection.kind, network, expiresAt };
}

async function authorizeSensitiveSend(request: SensitiveSendAuthorizeRequest) {
  await assertSensitiveSendProfile(request);
  return sensitiveSendAuthorizations.authorize(request);
}

async function translateWithDeepSeek(request: TranslateRequest): Promise<string> {
  const config = await readConfig();
  const deepseekApiKey = clientLicenseManager?.getServiceSecret() || await readDevelopmentServiceSecret();
  if (!deepseekApiKey) {
    throw new Error('DeepSeek API key is not configured.');
  }

  const requestId = request.requestId || randomUUID();
  const userId = (request.userId || (request.profileId ? `df-${request.profileId}` : 'df-default'))
    .replace(/[^a-zA-Z0-9\-_]/g, '_')
    .slice(0, 512);
  const logBase = {
    requestId,
    userId,
    from: request.from || '',
    to: request.to,
    textHash: hashForLog(request.text || ''),
    sourceHash: request.sourceHash || hashForLog(request.text || ''),
    textLength: request.text?.length ?? 0,
    reason: request.reason || '',
    profileId: request.profileId || '',
    profileName: request.profileName || '',
    platform: request.platform || '',
    messageKey: request.messageKey || '',
    contactId: request.contactId || '',
    contactIdType: request.contactIdType || '',
    contactTitle: request.contactTitle || '',
    direction: request.direction || '',
    messagePart: request.messagePart || ''
  };
  const isComposerEnglishRequest = ['composer-enter', 'composer-pretranslate'].includes(request.reason || '') && /English/i.test(request.to || '');
  const composerEnglishPrompt = `请将中文翻译成自然的美式英文 WhatsApp 聊天语气。

说话人设：
- 35岁女性
- 自然、成熟、亲切，但不随便
- 像真实美国人手机打字，不像书面翻译
- 带一点优雅自嘲和轻松幽默
- 可以有一点常见网络梗，但不要尬，不要过度年轻化
- 语气有温度，有真人打字节奏

聊天风格：
- 用自然的美式手机聊天表达，但必须忠实原意
- 口语化只允许调整表达方式，不允许新增原文没有的对象、事实、情绪、评价或暗示
- 短句优先保持短句，不主动扩写或补充对象
- 句子可以自然简短，有手机聊天节奏
- 优先使用自然的日常词汇和英文缩合形式，例如 I'm, you're, don't, can't
- 默认不使用 rn, ngl, tbh, idk, lmao 等网络缩写
- 可以偶尔用大写强调情绪，比如 SO good, I KNOW, SOAKED，但不要整句大写
- 可以少量使用语气词，比如 haha, lol, honestly, kinda, like, you know, I mean
- 可以少量 emoji，最多 1 个，不是每句都加
- 允许轻微随性，比如 lmaoo, sooo, omg，但只能在语境合适时使用

硬性限制：
- 不要呆板
- 不要像客服
- 不要像机器翻译
- 不要过度俚语化
- 不要装嫩
- 不要显得油腻或刻意
- 不要扩写，不要新增事实
- 不要把问题改写成带新对象或新评价的问题
- 保持原意和情绪

符号限制：
- 不使用句号 .
- 不使用破折号 -
- 不使用分号 ;
- 不使用中文标点
- 如需停顿，用逗号或自然分句

输出规则：
- 只输出英文译文
- 不解释
- 不加引号`;
  const strictComposerEnglishPrompt = `将下面的中文忠实翻译成简短、自然的美式英文私聊表达。
只翻译原文，不要回应原文，不要解释翻译行为，不要新增任何事实、动作、态度或上下文。
短句必须保持简短，例如“你好”只能翻译为 Hi、Hello 或 Hey there 这类短表达。
只输出英文译文，不加引号。`;
  const composerLayoutPrompt = `Preserve the source line structure exactly. Keep every line break and blank line in the same position. Do not merge separate lines or paragraphs. If a source line is a question, retain an English question mark (?) in the translated line. The punctuation ban does not apply to question marks.`;

  const translateOnce = async (strictChinese: boolean, strictComposer = false) => {
    const prompt = strictComposer ? [
      strictComposerEnglishPrompt,
      composerLayoutPrompt,
      '待翻译中文：',
      request.text
    ].join('\n\n') : isComposerEnglishRequest ? [
      composerEnglishPrompt,
      composerLayoutPrompt,
      '待翻译中文：',
      request.text
    ].join('\n\n') : [
      strictChinese
        ? `Translate the following chat message${request.from ? ` from ${request.from}` : ''} into Simplified Chinese. The sentence itself must be Chinese and must contain Chinese characters; keep only names, brands, URLs, phone numbers, and product names unchanged. If the text is a normal phrase such as "See you soon", translate its meaning. Do not return English-only output.`
        : `Translate the following chat message${request.from ? ` from ${request.from}` : ''} to ${request.to}.`,
      'Keep emoji, URLs, phone numbers, product names, and line breaks unchanged.',
      'Return only the translated message, with no explanation.',
      request.text
    ].join('\n\n');

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepseekApiKey}`
      },
      body: JSON.stringify({
        model: config.deepseekModel || defaultModel,
        user_id: userId,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
          temperature: strictChinese ? 0.1 : strictComposer ? 0.05 : isComposerEnglishRequest ? 0.2 : 0.2
      })
    });

    if (!response.ok) {
      await appendTranslateRequestLog({ ...logBase, status: 'failed', httpStatus: response.status, strictChinese });
      throw new Error(`DeepSeek request failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  };

  const translationPromptLeakPattern = /(?:translate the following chat message|return only the translated message|keep emoji,\s*urls|请将以下英文聊天信息翻译成中文|保留表情符号|仅返回翻译后的信息|无需解释)/i;
  const stripTranslationPromptLeak = (value: string) => {
    const text = (value || '').trim();
    if (!text || !translationPromptLeakPattern.test(text)) return text;
    const lines = text
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !translationPromptLeakPattern.test(line));
    return lines.join('\n').trim();
  };
  const sanitizeChineseTranslation = (value: string) => {
    const stripped = stripTranslationPromptLeak(value)
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .trim();
    if (translationPromptLeakPattern.test(stripped)) {
      throw new Error('Translation prompt leaked into Chinese result.');
    }
    return stripped;
  };
  const sanitizeComposerEnglish = (value: string) => value
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[，、；：]/g, ',')
    .replace(/？/g, '?')
    .replace(/！/g, '!')
    .replace(/[。．；—…“”‘’《》【】（）]/g, '')
    .replace(/[.;-]/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s*,\s*/g, ', ').replace(/,{2,}/g, ',').replace(/[\t ]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
  const restoreComposerLayout = (source: string, translated: string) => {
    const sourceLines = source.replace(/\r\n?/g, '\n').split('\n');
    const translatedLines = translated.replace(/\r\n?/g, '\n').split('\n').filter((line) => line.trim());
    const sourceTextLines = sourceLines.filter((line) => line.trim());
    if (sourceTextLines.length !== translatedLines.length) return translated;
    let translatedIndex = 0;
    return sourceLines.map((sourceLine) => {
      if (!sourceLine.trim()) return '';
      let line = translatedLines[translatedIndex++]?.trim() || '';
      if (/[？?]\s*$/.test(sourceLine) && !/\?\s*$/.test(line)) line += '?';
      return line;
    }).join('\n').trim();
  };
  const composerLayoutMatches = (source: string, translated: string) => {
    const sourceLines = source.replace(/\r\n?/g, '\n').split('\n');
    const translatedLines = translated.replace(/\r\n?/g, '\n').split('\n');
    if (sourceLines.length === 1) return true;
    if (sourceLines.length !== translatedLines.length) return false;
    return sourceLines.every((line, index) => Boolean(line.trim()) === Boolean(translatedLines[index]?.trim()));
  };
  const isSuspiciousComposerEnglish = (value: string) => {
    const sourceChineseLength = Array.from(request.text || '').filter((char) => /[一-鿿]/.test(char)).length;
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    if (!value || /thanks for the heads up|switch (?:it|this) (?:over )?to english|english version|here(?:'s| is) (?:the|your) translation|\btranslat(?:e|ed|ion)\b/i.test(value)) return true;
    return sourceChineseLength > 0 && sourceChineseLength <= 4 && (value.length > 48 || words > 8);
  };

  const runDeepSeekTranslation = async () => {
    await appendTranslateRequestLog({ ...logBase, status: 'start' });
    let translated = await translateOnce(false);
    const wantsChinese = /Chinese|zh|Simplified/i.test(request.to || '');
    const sourceHasLatin = /[A-Za-z]{2,}/.test(request.text || '');
    if (wantsChinese) translated = sanitizeChineseTranslation(translated);
    const translatedHasChinese = /[\u4e00-\u9fff]/.test(translated);
    if (wantsChinese && sourceHasLatin && translated && !translatedHasChinese) {
      await appendTranslateRequestLog({ ...logBase, status: 'retry-chinese', translatedLength: translated.length });
      translated = sanitizeChineseTranslation(await translateOnce(true));
    }
    if (isComposerEnglishRequest) {
      translated = sanitizeComposerEnglish(translated);
      if (isSuspiciousComposerEnglish(translated) || !composerLayoutMatches(request.text || '', translated)) {
        await appendTranslateRequestLog({ ...logBase, status: 'retry-composer-faithful', translatedLength: translated.length });
        translated = sanitizeComposerEnglish(await translateOnce(false, true));
      }
      if (isSuspiciousComposerEnglish(translated)) throw new Error('Composer translation expanded beyond the source.');
      translated = restoreComposerLayout(request.text || '', translated);
      if (!composerLayoutMatches(request.text || '', translated)) throw new Error('Composer translation did not preserve source line layout.');
    }
    await appendTranslateRequestLog({ ...logBase, status: 'success', translatedLength: translated.length });
    registerApprovedComposerTranslation(request, requestId, translated);
    return translated;
  };

  const dedupeKey = request.reason === 'visible-message' && request.profileId && request.sourceHash
    ? `${request.profileId}:${request.sourceHash}`
    : '';
  if (!dedupeKey) return runDeepSeekTranslation();

  const existing = visibleMessageDeepSeekDedupe.get(dedupeKey);
  if (existing) {
    await appendTranslateRequestLog({ ...logBase, status: 'dedupe-wait' });
    const translated = await existing;
    await appendTranslateRequestLog({ ...logBase, status: 'dedupe-success', translatedLength: translated.length });
    return translated;
  }

  const promise = runDeepSeekTranslation();
  visibleMessageDeepSeekDedupe.set(dedupeKey, promise);
  try {
    return await promise;
  } catch (error) {
    throw error;
  } finally {
    if (visibleMessageDeepSeekDedupe.get(dedupeKey) === promise) {
      visibleMessageDeepSeekDedupe.delete(dedupeKey);
    }
  }
}

function toggleMainWindowSize(targetWindow: BrowserWindow) {
  if (!targetWindow.isMaximized()) {
    targetWindow.maximize();
    return;
  }

  const display = screen.getDisplayMatching(targetWindow.getBounds());
  const width = Math.min(compactWindowWidth, display.workArea.width);
  const height = Math.min(compactWindowHeight, display.workArea.height);
  const compactBounds = {
    x: display.workArea.x + Math.floor((display.workArea.width - width) / 2),
    y: display.workArea.y + Math.floor((display.workArea.height - height) / 2),
    width,
    height
  };
  targetWindow.unmaximize();
  setTimeout(() => {
    if (!targetWindow.isDestroyed() && !targetWindow.isMaximized()) targetWindow.setBounds(compactBounds);
  }, 50);
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent | IpcMainEvent) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedMainUrl(event.senderFrame.url)
  ) {
    throw new Error('Blocked IPC call from an untrusted renderer.');
  }
}

function trustedHandle<TArgs extends unknown[], TResult>(
  channel: string,
  runtimeRequired: boolean,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    if (runtimeRequired) assertClientRuntimeAllowed();
    return handler(event, ...(args as TArgs));
  });
}

function assertText(value: unknown, label: string, maxLength: number, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertSerializedSize(value: unknown, label: string, maxBytes: number) {
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${label} is not serializable.`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new Error(`${label} is too large.`);
}

function validatePlatform(value: unknown): Platform {
  if (typeof value !== 'string' || !supportedPlatforms.has(value as Platform)) throw new Error('Platform is invalid.');
  return value as Platform;
}

function validateWorkspaceBounds(value: SignalWorkspaceBounds) {
  if (!value || typeof value !== 'object') throw new Error('Signal workspace bounds are invalid.');
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    if (!Number.isFinite(value[field])) throw new Error('Signal workspace bounds are invalid.');
  }
  if (value.width < 1 || value.height < 1 || value.width > 16384 || value.height > 16384 || typeof value.visible !== 'boolean') {
    throw new Error('Signal workspace bounds are invalid.');
  }
  return value;
}

function validateTranslateRequest(value: TranslateRequest) {
  if (!value || typeof value !== 'object') throw new Error('Translation request is invalid.');
  assertText(value.text, 'Translation text', 20_000);
  assertText(value.to, 'Translation target', 80);
  if (value.profileId) assertProfileId(value.profileId);
  if (value.platform) validatePlatform(value.platform);
  for (const field of ['requestId', 'userId', 'from', 'reason', 'profileName', 'sourceHash', 'messageKey', 'contactId', 'contactTitle'] as const) {
    if (value[field] !== undefined) assertText(value[field], `Translation ${field}`, 512, true);
  }
  assertSerializedSize(value, 'Translation request', 64 * 1024);
  return value;
}

function validateCacheRequest(value: TranslationCacheLoadRequest | TranslationCacheSetRequest | TranslationCacheLookupRequest) {
  if (!value || typeof value !== 'object') throw new Error('Translation cache request is invalid.');
  assertProfileId(value.profileId);
  if (value.platform) validatePlatform(value.platform);
  for (const field of ['profileName', 'contactId', 'contactTitle', 'contactRemark'] as const) {
    if (value[field] !== undefined) assertText(value[field], `Cache ${field}`, 512, true);
  }
  assertSerializedSize(value, 'Translation cache request', 128 * 1024);
  return value;
}

function registerIpc() {
  trustedHandle('client-license:status', false, () => clientLicenseManager?.getStatus());
  trustedHandle('client-license:set-username', false, (_event, username: string) =>
    clientLicenseManager?.setUsername(assertText(username, 'Username', 64))
  );
  trustedHandle('client-license:activate', false, async (_event, licenseCode: string) => {
    if (!clientLicenseManager) throw new Error('客户端授权模块尚未初始化');
    const result = await clientLicenseManager.activate(assertText(licenseCode, 'License code', 32 * 1024));
    if (result.selfDestructRequired) {
      await beginAuthorizationSelfDestruct();
      return result;
    }
    if (result.ok) await prepareAuthorizedRuntime();
    return result;
  });
  trustedHandle('client-license:copy-machine-info', false, async () => {
    if (!clientLicenseManager) throw new Error('客户端授权模块尚未初始化');
    try {
      clipboard.writeText(clientLicenseManager.machineInfoText());
      return { ok: true, status: clientLicenseManager.getStatus() };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '复制本机信息失败',
        status: clientLicenseManager.getStatus()
      };
    }
  });
  trustedHandle('app:is-packaged', false, () => app.isPackaged);
  trustedHandle('config:get', true, () => readConfig());
  trustedHandle('config:save', true, (_event, config: AppConfig) => {
    assertSerializedSize(config, 'Application config', 1024 * 1024);
    return saveConfig(config);
  });
  trustedHandle('platforms:get', true, () => getPlatformCatalog());
  trustedHandle('profile:create', true, (_event, platform: Platform, name: string, group: string) => {
    return createProfile(validatePlatform(platform), assertText(name, 'Profile name', 80), assertText(group, 'Profile group', 80));
  });
  trustedHandle('profile:rename', true, (_event, id: string, name: string, group: string) => {
    return renameProfile(assertProfileId(id), assertText(name, 'Profile name', 80), assertText(group, 'Profile group', 80));
  });
  trustedHandle('profile:remove', true, (_event, id: string) => {
    return removeProfile(assertProfileId(id));
  });
  trustedHandle('signal:launch', true, (_event, id: string) => {
    return launchSignalProfile(assertProfileId(id));
  });
  trustedHandle('signal:set-workspace-bounds', true, (_event, id: string, bounds: SignalWorkspaceBounds) =>
    setSignalWorkspaceBounds(assertProfileId(id), validateWorkspaceBounds(bounds))
  );
  trustedHandle('signal:hide', true, (_event, id: string) => hideSignalProfile(assertProfileId(id)));
  trustedHandle('signal:stop', true, (_event, id: string) => stopSignalProfile(assertProfileId(id)));
  trustedHandle('signal:execute-script', true, (_event, id: string, script: string) =>
    executeSignalScript(assertProfileId(id), assertText(script, 'Signal operation script', 900 * 1024))
  );
  trustedHandle('signal:debug-log', true, (_event, debugEvent: Record<string, unknown>) => {
    assertSerializedSize(debugEvent, 'Signal debug event', 64 * 1024);
    return appendSignalTranslationDebugLog(debugEvent);
  });
  trustedHandle('translate', true, (_event, request: TranslateRequest) => translateWithDeepSeek(validateTranslateRequest(request)));
  trustedHandle('send-integrity:authorize', true, (_event, request: SendAuthorizationRequest) => {
    if (!request || typeof request !== 'object') throw new Error('Send authorization request is invalid.');
    assertText(request.requestId, 'Send request ID', 512);
    assertProfileId(request.profileId);
    validatePlatform(request.platform);
    assertText(request.text, 'Send text', 20_000);
    if (request.conversationSignature !== undefined) assertText(request.conversationSignature, 'Conversation signature', 512, true);
    assertSerializedSize(request, 'Send authorization request', 64 * 1024);
    return authorizeTranslatedSend(request);
  });
  trustedHandle('send-integrity:prepare-sensitive', true, (_event, request: SensitiveSendPrepareRequest) => {
    if (!request || typeof request !== 'object') throw new Error('Sensitive send preparation is invalid.');
    assertProfileId(request.profileId);
    validatePlatform(request.platform);
    assertText(request.conversationSignature, 'Conversation signature', 512);
    assertText(request.text, 'Sensitive send text', 256);
    if (request.network !== undefined && !['TRC20', 'ERC20', 'BEP20', 'Solana'].includes(request.network)) {
      throw new Error('Wallet network is invalid.');
    }
    assertSerializedSize(request, 'Sensitive send preparation', 8 * 1024);
    return prepareSensitiveSend(request);
  });
  trustedHandle('send-integrity:authorize-sensitive', true, (_event, request: SensitiveSendAuthorizeRequest) => {
    if (!request || typeof request !== 'object') throw new Error('Sensitive send authorization is invalid.');
    assertText(request.token, 'Sensitive send token', 128);
    assertProfileId(request.profileId);
    validatePlatform(request.platform);
    assertText(request.conversationSignature, 'Conversation signature', 512);
    assertText(request.text, 'Sensitive send text', 256);
    if (request.network !== undefined && !['TRC20', 'ERC20', 'BEP20', 'Solana'].includes(request.network)) {
      throw new Error('Wallet network is invalid.');
    }
    assertSerializedSize(request, 'Sensitive send authorization', 8 * 1024);
    return authorizeSensitiveSend(request);
  });
  trustedHandle('translation-cache:load', true, async (_event, request: TranslationCacheLoadRequest) =>
    (await isMarkedNonEnglishContact(validateCacheRequest(request))) ? [] : loadTranslationCache(request)
  );
  trustedHandle('translation-cache:lookup', true, async (_event, request: TranslationCacheLookupRequest) => {
    validateCacheRequest(request);
    if (!Array.isArray(request.sourceHashes) || request.sourceHashes.length > 240) throw new Error('Cache lookup hashes are invalid.');
    request.sourceHashes.forEach((hash) => assertText(hash, 'Cache source hash', 256));
    return (await isMarkedNonEnglishContact(request)) ? [] : lookupTranslationCache(request);
  });
  trustedHandle('translation-cache:save-entry', true, (_event, request: TranslationCacheSetRequest) => {
    validateCacheRequest(request);
    assertText(request.sourceHash, 'Cache source hash', 256);
    assertText(request.translatedText, 'Cache translation', 30_000);
    if (request.sourceText !== undefined) assertText(request.sourceText, 'Cache source text', 30_000, true);
    return saveTranslationCacheEntry(request);
  });
  trustedHandle('translation-cache:mark-non-english-contact', true, (_event, request: NonEnglishContactRequest) => {
    validateCacheRequest(request);
    return markNonEnglishContact(request);
  });
  trustedHandle('system:get-memory-status', false, () => getMemoryStatus());
  trustedHandle('lock-screen:status', true, () => getLockScreenStatus());
  trustedHandle('lock-screen:set-pin', true, (_event, pin: string) => setLockScreenPin(assertText(pin, 'Lock PIN', 32)));
  trustedHandle('lock-screen:unlock', true, (_event, pin: string) => unlockLockScreen(assertText(pin, 'Lock PIN', 32)));
  trustedHandle('window:set-theme', true, (event, theme: 'blackGold' | 'pink') => {
    if (theme !== 'blackGold' && theme !== 'pink') throw new Error('Theme is invalid.');
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    void theme;
    (targetWindow as BrowserWindow & { setTitleBarOverlay?: (overlay: false) => void } | null)?.setTitleBarOverlay?.(false);
  });
  trustedHandle('clipboard:read-text', true, () => clipboard.readText().slice(0, 1024 * 1024));
  trustedHandle('clipboard:write-text', true, (_event, text: string) => {
    clipboard.writeText(assertText(text, 'Clipboard text', 1024 * 1024, true));
  });
  trustedHandle('window:minimize', false, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    hideAllSignalWindows();
    targetWindow?.minimize();
  });
  trustedHandle('window:toggle-maximize', false, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (targetWindow) toggleMainWindowSize(targetWindow);
  });
  trustedHandle('window:close', false, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.on('window-control', (event, action: 'minimize' | 'toggle-maximize' | 'close') => {
    assertTrustedIpcSender(event);
    if (!['minimize', 'toggle-maximize', 'close'].includes(action)) return;
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) return;

    if (action === 'minimize') {
      hideAllSignalWindows();
      targetWindow.minimize();
      return;
    }

    if (action === 'toggle-maximize') {
      toggleMainWindowSize(targetWindow);
      return;
    }

    if (action === 'close') {
      targetWindow.close();
    }
  });
}

function getPlatformCatalog(): PlatformInfo[] {
  return Object.entries(platformDefaults).map(([platform, info]) => ({
    platform: platform as Platform,
    ...info
  }));
}

function configureSession(profile: ChatProfile) {
  const ses = session.fromPartition(profile.partition);
  ses.setUserAgent(profile.fingerprint.userAgent);
  partitionPolicies.set(profile.partition, profile.platform);
  sessionPolicies.set(ses, profile.platform);

  if (configuredPartitions.has(profile.partition)) {
    return;
  }

  configuredPartitions.add(profile.partition);
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (!isAllowedPlatformUrl(profile.platform, requestingOrigin)) return false;
    return permission === 'notifications' || permission === 'media';
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || contents.getURL();
    const allowedOrigin = isAllowedPlatformUrl(profile.platform, requestingUrl);
    const allowedPermission = permission === 'notifications' || permission === 'media';
    callback(allowedOrigin && allowedPermission);
  });
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', (_event, item) => {
    if (/\.(?:exe|msi|msp|com|scr|cmd|bat|ps1|vbs|js|jse|wsf|wsh|dll|lnk|url)$/i.test(item.getFilename())) {
      item.cancel();
    }
  });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = {
      ...details.requestHeaders,
      'User-Agent': profile.fingerprint.userAgent
    };

    callback({ requestHeaders });
  });
}

async function prepareAuthorizedRuntime() {
  if (authorizedRuntimePrepared) return;
  assertClientRuntimeAllowed();
  if (!clientLicenseManager) throw new Error('客户端授权模块尚未初始化');
  const material = clientLicenseManager.getRuntimeSecurityMaterial();
  const binding = await ensureRuntimeBinding(
    defaultRuntimeBindingPath(),
    material
  );
  activeRuntimeSecurity = {
    payload: binding.payload,
    devicePrivateKeyPem: material.devicePrivateKeyPem
  };
  await initializeTranslationCacheEncryption(binding.payload);
  for (const executablePath of signalExecutableCandidates()) {
    if (!(await pathExists(executablePath))) continue;
    try {
      await mirrorRuntimeBinding(defaultRuntimeBindingPath(), signalRuntimeBindingPath(executablePath));
    } catch {
      // The profile-root binding remains authoritative if an installation directory is read-only.
    }
    break;
  }
  const config = await readConfig();
  await saveConfig(config);
  await ensureSignalInstanceDirs(config);
  await ensureSignalProfileBindings(config, binding.payload, material.devicePrivateKeyPem);
  await cleanupOrphanProfilePartitions(config);
  await cleanupOrphanSignalInstances(config);
  scheduleHideConfiguredSignalTaskbarButtons(config);
  config.profiles.forEach(configureSession);
  authorizedRuntimePrepared = true;
}

async function runDevelopmentCacheSmokeCheck() {
  if (app.isPackaged || process.env.MAOYI_SMOKE_WRITE_CACHE !== '1') return;
  const request: TranslationCacheSetRequest = {
    profileId: '00000000-0000-4000-8000-000000000001',
    platform: 'whatsapp',
    profileName: 'Smoke Profile',
    contactId: 'smoke-contact',
    contactIdType: 'platform',
    sourceHash: 'smoke-source-hash',
    sourceText: 'Security cache smoke source 123456789',
    translatedText: '安全缓存测试译文 123456789'
  };
  await saveTranslationCacheEntry(request);
  const loaded = await lookupTranslationCache({ ...request, sourceHashes: [request.sourceHash] });
  if (loaded[0]?.translatedText !== request.translatedText) throw new Error('Encrypted translation cache smoke round trip failed.');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: compactWindowWidth,
    height: compactWindowHeight,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#08090d',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedMainUrl(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const platform = partitionPolicies.get(params.partition || '');
    if (!platform || !isAllowedPlatformUrl(platform, params.src || '')) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });
  mainWindow.on('minimize', () => {
    hideAllSignalWindows();
  });
  mainWindow.on('hide', () => {
    hideAllSignalWindows();
  });
  mainWindow.on('restore', requestSignalWorkspaceSyncBurst);
  mainWindow.on('show', requestSignalWorkspaceSyncBurst);
  mainWindow.on('focus', () => {
    focusedSignalProfileId = null;
    cancelAppGroupBlurCheck();
    requestSignalWorkspaceSyncBurst();
  });
  mainWindow.on('blur', scheduleAppGroupBlurCheck);
  mainWindow.on('move', scheduleVisibleSignalMoveSync);
  mainWindow.on('resize', resyncVisibleSignalWindows);

  const readyToShow = new Promise<void>((resolve) => {
    let resolved = false;
    const resolveOnce = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    const timer = setTimeout(resolveOnce, rendererReadyTimeoutMs);
    mainWindow?.once('ready-to-show', () => {
      clearTimeout(timer);
      resolveOnce();
    });
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadURL('app://bundle/index.html');
  }

  await readyToShow;
  if (!mainWindow.isDestroyed()) {
    mainWindow.show();
    requestSignalWorkspaceSyncBurst();
    const smokeCapturePath = !app.isPackaged ? process.env.MAOYI_SMOKE_CAPTURE_PATH?.trim() : '';
    if (smokeCapturePath) {
      if (process.env.MAOYI_SMOKE_ENTER_RUNTIME === '1') {
        await mainWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('进入开发环境'))?.click()`);
        await wait(750);
      }
      await wait(500);
      const image = await mainWindow.webContents.capturePage();
      await writeFile(smokeCapturePath, image.toPNG());
      if (process.env.MAOYI_SMOKE_TEST_EXIT === '1') setTimeout(() => app.quit(), 250);
    }
  }
}

if (cloneResetWorkerMode) {
  app.whenReady().then(async () => {
    try {
      await runCloneResetWorker(cloneResetPlanPath);
      app.exit(0);
    } catch {
      dialog.showErrorBox(appDisplayName, '初始化未完成，请重新启动程序重试');
      app.exit(1);
    }
  });
} else {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    registerLocalAppProtocol();
    installWebContentsSecurityPolicy();
    if (!(await initializeUserDataPath())) {
      app.quit();
      return;
    }
    await cleanupPackagedRuntimeLogs();
    clientLicenseManager = new ClientLicenseManager();
    await clientLicenseManager.initialize();
    if (!(await verifyRuntimeCloneState())) return;
    if (clientLicenseManager.isRuntimeAllowed()) {
      await prepareAuthorizedRuntime();
      await runDevelopmentCacheSmokeCheck();
    }
    registerIpc();
    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch(showFatalStartupError);
}

if (!cloneResetWorkerMode) app.on('before-quit', (event) => {
  if (signalShutdownBeforeQuitDone) return;
  event.preventDefault();
  signalShutdownBeforeQuitTimer ??= setTimeout(() => {
    signalShutdownBeforeQuitDone = true;
    app.quit();
  }, gracefulQuitTimeoutMs);
  signalShutdownBeforeQuitPromise ??= stopAllSignalProfilesForQuit().then(() => cleanupPackagedRuntimeLogs()).finally(() => {
    if (signalShutdownBeforeQuitTimer) {
      clearTimeout(signalShutdownBeforeQuitTimer);
      signalShutdownBeforeQuitTimer = null;
    }
    signalShutdownBeforeQuitDone = true;
    app.quit();
  });
});

if (!cloneResetWorkerMode) app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { platformDefaults };
