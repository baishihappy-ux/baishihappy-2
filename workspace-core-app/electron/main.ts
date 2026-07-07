import { app, BrowserWindow, Menu, clipboard, ipcMain, screen, session, webContents } from 'electron';
import { appendFile, cp, readdir, readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AppConfig,
  ChatProfile,
  FingerprintProfile,
  Platform,
  PlatformInfo,
  TranslateRequest,
  TranslationCacheEntry,
  TranslationCacheLoadRequest,
  TranslationCacheSetRequest
} from './shared.js';

const defaultModel = 'deepseek-v4-flash';
const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, '../electron/preload.cjs');

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
app.userAgentFallback = defaultBrowserUserAgent;
app.commandLine.appendSwitch(
  'disable-features',
  'ImeThread,SpareRendererForSitePerProcess,SpellChecking,SpellingService,V8CodeCache,WinDelaySpellcheckServiceInit'
);

let mainWindow: BrowserWindow | null = null;
const configuredPartitions = new Set<string>();
const translationCacheWriteQueues = new Map<string, Promise<void>>();

function configPath() {
  return join(app.getPath('userData'), 'config.json');
}

function profilesPath() {
  return join(app.getPath('userData'), 'profiles.json');
}

function translateRequestLogPath() {
  return join(app.getPath('userData'), 'translate-requests.jsonl');
}

function partitionStoragePath(partition: string) {
  if (!partition.startsWith('persist:')) return null;
  return join(app.getPath('userData'), 'Partitions', partition.slice('persist:'.length));
}

function signalInstancesRoot() {
  return join(app.getPath('userData'), 'SignalInstances');
}

function signalInstancePath(id: string) {
  return join(signalInstancesRoot(), `Signal-${id}`);
}

function translationCacheRoot() {
  return join(app.getPath('userData'), 'TranslationCache');
}

function safeProfileFileName(profileId: string) {
  return profileId.replace(/[^a-z0-9-]/gi, '_');
}

function safePathPart(value: string) {
  return (value || 'unknown')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'unknown';
}

function translationCachePath(profileId: string) {
  return join(translationCacheRoot(), `${safeProfileFileName(profileId)}.json`);
}

function scopedTranslationCachePath(request: TranslationCacheLoadRequest | TranslationCacheSetRequest) {
  if (!request.platform || !request.profileName || !request.contactId) {
    return translationCachePath(request.profileId);
  }
  return join(
    translationCacheRoot(),
    safePathPart(request.platform),
    safePathPart(request.profileName),
    safePathPart(`${request.contactIdType || 'unknown'}-${request.contactId}`),
    'translations.json'
  );
}

function profileTranslationCacheDir(platform: Platform, profileName: string) {
  return join(translationCacheRoot(), safePathPart(platform), safePathPart(profileName));
}

function defaultConfig(): AppConfig {
  return {
    profiles: [],
    activeProfileId: null,
    deepseekApiKey: '',
    deepseekModel: defaultModel
  };
}

async function readConfig(): Promise<AppConfig> {
  const fallbackProfiles = await readProfileBackup();
  try {
    const raw = (await readFile(configPath(), 'utf8')).replace(/^\uFEFF/, '');
    const config = sanitizeConfig({ ...defaultConfig(), ...JSON.parse(raw) });
    if (!config.profiles.length && fallbackProfiles.length) {
      return sanitizeConfig({ ...config, profiles: fallbackProfiles, activeProfileId: fallbackProfiles[0]?.id ?? null });
    }
    return config;
  } catch {
    return sanitizeConfig({ ...defaultConfig(), profiles: fallbackProfiles, activeProfileId: fallbackProfiles[0]?.id ?? null });
  }
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
  const profiles = config.profiles.map((profile, index) => {
    const fallbackFingerprint = buildFingerprint(index);
    return {
      ...profile,
      signalDataDir: profile.platform === 'signal' ? profile.signalDataDir || signalInstancePath(profile.id) : undefined,
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
    ...config,
    profiles,
    activeProfileId
  };
}

function userAgentForPlatform(platform: Platform) {
  if (platform === 'signal') return whatsappUserAgent;
  return platform === 'whatsapp' ? whatsappUserAgent : telegramUserAgent;
}

async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const sanitizedConfig = sanitizeConfig(config);
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeJsonAtomic(configPath(), sanitizedConfig);
  await writeJsonAtomic(profilesPath(), sanitizedConfig.profiles);
  return sanitizedConfig;
}

async function writeJsonAtomic(path: string, value: unknown) {
  const tempPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
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

function randomId() {
  return crypto.randomUUID();
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

async function createProfile(platform: Platform, name?: string): Promise<ChatProfile> {
  const config = await readConfig();
  const id = randomId();
  const label = platformDefaults[platform].label;
  const samePlatformCount = config.profiles.filter((profile) => profile.platform === platform).length;
  const profile: ChatProfile = {
    id,
    name: name || `${label} ${samePlatformCount + 1}`,
    platform,
    partition: `persist:chat-${id}`,
    signalDataDir: platform === 'signal' ? signalInstancePath(id) : undefined,
    createdAt: Date.now(),
    fingerprint: { ...buildFingerprint(config.profiles.length), userAgent: userAgentForPlatform(platform) }
  };

  if (profile.signalDataDir) {
    await mkdir(profile.signalDataDir, { recursive: true });
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

async function moveProfileTranslationCache(platform: Platform, oldName: string, newName: string) {
  const sourcePath = profileTranslationCacheDir(platform, oldName);
  const targetPath = profileTranslationCacheDir(platform, newName);
  if (sourcePath === targetPath || !(await pathExists(sourcePath))) return;
  await mkdir(dirname(targetPath), { recursive: true });
  if (!(await pathExists(targetPath))) {
    await rename(sourcePath, targetPath);
    return;
  }
  await cp(sourcePath, targetPath, { recursive: true, force: false, errorOnExist: false });
  await removePathWithRetry(sourcePath);
}

async function renameProfile(id: string, name: string): Promise<AppConfig> {
  const nextName = name.trim();
  if (!id || !nextName) throw new Error('Profile name is required.');
  const config = await readConfig();
  const profile = config.profiles.find((item) => item.id === id);
  if (!profile) throw new Error(`Profile ${id} was not found.`);
  const oldName = profile.name;
  if (oldName === nextName) return config;
  const duplicate = config.profiles.some((item) => item.id !== id && item.platform === profile.platform && item.name === nextName);
  if (duplicate) throw new Error(`Profile name ${nextName} already exists.`);
  profile.name = nextName;
  const savedConfig = await saveConfig(config);
  await moveProfileTranslationCache(profile.platform, oldName, nextName);
  return savedConfig;
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
    await destroyProfilePartition(profile.partition);
    await removePathWithRetry(translationCachePath(profile.id));
    if (profile.signalDataDir) {
      await removePathWithRetry(profile.signalDataDir);
    }
  }
  return savedConfig;
}

async function readTranslationCacheFile(request: TranslationCacheLoadRequest | TranslationCacheSetRequest): Promise<TranslationCacheEntry[]> {
  try {
    const raw = (await readFile(scopedTranslationCachePath(request), 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is TranslationCacheEntry =>
        Boolean(entry?.sourceHash && entry?.translatedText && Number.isFinite(entry?.updatedAt))
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function loadTranslationCache(request: TranslationCacheLoadRequest): Promise<TranslationCacheEntry[]> {
  const offset = Math.max(0, request.offset ?? 0);
  const limit = Math.min(Math.max(1, request.limit ?? 100), 1000);
  const entries = await readTranslationCacheFile(request);
  return entries.slice(offset, offset + limit);
}

async function saveTranslationCacheEntry(request: TranslationCacheSetRequest): Promise<void> {
  if (!request.profileId || !request.sourceHash || !request.translatedText) return;
  const previousWrite = translationCacheWriteQueues.get(request.profileId) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(() => saveTranslationCacheEntryNow(request));
  translationCacheWriteQueues.set(request.profileId, nextWrite);
  try {
    await nextWrite;
  } finally {
    if (translationCacheWriteQueues.get(request.profileId) === nextWrite) {
      translationCacheWriteQueues.delete(request.profileId);
    }
  }
}

async function saveTranslationCacheEntryNow(request: TranslationCacheSetRequest): Promise<void> {
  const entries = await readTranslationCacheFile(request);
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
  const nextEntries = [
    nextEntry,
    ...entries.filter((entry) => entry.sourceHash !== request.sourceHash)
  ].slice(0, 50000);
  const targetPath = scopedTranslationCachePath(request);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeJsonAtomic(targetPath, nextEntries);
}

async function destroyProfilePartition(partition: string) {
  const ses = session.fromPartition(partition);

  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed() || contents.session !== ses) continue;
    contents.close({ waitForBeforeUnload: false });
  }

  await ses.clearStorageData();
  await ses.clearCache();
  await ses.closeAllConnections();
  ses.flushStorageData();

  const storagePath = partitionStoragePath(partition);
  if (storagePath) {
    await removePathWithRetry(storagePath);
  }

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
      .map((partitionName) => removePathWithRetry(join(partitionsRoot, partitionName)))
  );
}

async function ensureSignalInstanceDirs(config: AppConfig) {
  await Promise.all(
    config.profiles
      .filter((profile) => profile.platform === 'signal' && profile.signalDataDir)
      .map((profile) => mkdir(profile.signalDataDir as string, { recursive: true }))
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
      .filter((dirName) => /^Signal-[0-9a-f-]{36}$/i.test(dirName))
      .map((dirName) => join(signalInstancesRoot(), dirName))
      .filter((dirPath) => !activeSignalDirs.has(dirPath))
      .map((dirPath) => removePathWithRetry(dirPath))
  );
}

async function translateWithDeepSeek(request: TranslateRequest): Promise<string> {
  const config = await readConfig();
  if (!config.deepseekApiKey) {
    throw new Error('DeepSeek API key is not configured.');
  }

  const logBase = {
    from: request.from || '',
    to: request.to,
    textHash: hashForLog(request.text || ''),
    textLength: request.text?.length ?? 0
  };
  await appendTranslateRequestLog({ ...logBase, status: 'start' });

  const prompt = [
    `Translate the following chat message${request.from ? ` from ${request.from}` : ''} to ${request.to}.`,
    'Keep emoji, URLs, phone numbers, product names, and line breaks unchanged.',
    'Return only the translated message, with no explanation.',
    request.text
  ].join('\n\n');

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.deepseekApiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekModel || defaultModel,
      messages: [{ role: 'user', content: prompt }],
      thinking: { type: 'disabled' },
      temperature: 0.2
    })
  });

  if (!response.ok) {
    await appendTranslateRequestLog({ ...logBase, status: 'failed', httpStatus: response.status });
    throw new Error(`DeepSeek request failed: ${response.status}`);
  }

  const data = await response.json();
  const translated = data.choices?.[0]?.message?.content?.trim() || '';
  await appendTranslateRequestLog({ ...logBase, status: 'success', translatedLength: translated.length });
  return translated;
}

function registerIpc() {
  ipcMain.handle('config:get', readConfig);
  ipcMain.handle('config:save', (_event, config: AppConfig) => saveConfig(config));
  ipcMain.handle('platforms:get', () => getPlatformCatalog());
  ipcMain.handle('profile:create', (_event, platform: Platform, name?: string) => createProfile(platform, name));
  ipcMain.handle('profile:rename', (_event, id: string, name: string) => renameProfile(id, name));
  ipcMain.handle('profile:remove', (_event, id: string) => removeProfile(id));
  ipcMain.handle('translate', (_event, request: TranslateRequest) => translateWithDeepSeek(request));
  ipcMain.handle('translation-cache:load', (_event, request: TranslationCacheLoadRequest) => loadTranslationCache(request));
  ipcMain.handle('translation-cache:save-entry', (_event, request: TranslationCacheSetRequest) => saveTranslationCacheEntry(request));
  ipcMain.handle('clipboard:read-text', () => clipboard.readText());
  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(text || '');
  });
  ipcMain.handle('window:minimize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    targetWindow?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow) return;
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
  });
  ipcMain.handle('window:close', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    targetWindow?.close();
  });
  ipcMain.on('window-control', (event, action: 'minimize' | 'toggle-maximize' | 'close') => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!targetWindow) return;

    if (action === 'minimize') {
      targetWindow.minimize();
      return;
    }

    if (action === 'toggle-maximize') {
      if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
      } else {
        targetWindow.maximize();
      }
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

  if (configuredPartitions.has(profile.partition)) {
    return;
  }

  configuredPartitions.add(profile.partition);
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = {
      ...details.requestHeaders,
      'User-Agent': profile.fingerprint.userAgent
    };

    callback({ requestHeaders });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#08090d',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#08090d',
      symbolColor: '#f2dc9d',
      height: 40
    },
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setMenuBarVisibility(false);

  const config = await readConfig();
  await saveConfig(config);
  await ensureSignalInstanceDirs(config);
  await cleanupOrphanProfilePartitions(config);
  await cleanupOrphanSignalInstances(config);
  config.profiles.forEach(configureSession);
  const readyToShow = new Promise<void>((resolve) => {
    mainWindow?.once('ready-to-show', () => resolve());
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  await readyToShow;
  if (!mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { platformDefaults };
