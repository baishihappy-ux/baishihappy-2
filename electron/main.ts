import {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  webContents,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Session
} from 'electron';
import { appendFile, cp, readdir, readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { createReadStream, lstatSync, readFileSync, realpathSync, statSync, type Dirent } from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';
import { cpus, freemem, networkInterfaces, totalmem } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  SmartReplyRequest,
  SmartReplyResult,
  TranslateRequest,
  TranslationCacheEntry,
  TranslationCacheLoadRequest,
  TranslationCacheLookupRequest,
  TranslationCacheSetRequest,
  NonEnglishContactRequest,
  LockScreenStatus,
  LockScreenSetPinResult,
  LockScreenUnlockResult,
  NetworkOfflineCheckResult,
  LockScreenPinChangeMode,
  LockScreenPinChangeAuthorizationResult,
  RemoteGuardActionResult,
  RemoteGuardState,
  RemoteGuardStatus
} from './shared.js';
import {
  buildWindowsChromiumUserAgent,
  buildSignalSourceOnlyAcceptanceDiagnostic,
  sanitizeLastActiveProfileIds,
  sanitizeProfileTabOrder,
  resolveProfileUserAgent,
  restoreComposerEnglishLayout,
  sanitizeComposerEnglishTranslation,
  signalSourceOnlyAcceptanceStages,
  workspaceAppForPlatform,
  type SignalSourceOnlyAcceptanceStage,
  type SignalSourceOnlyAcceptanceStageCounts
} from './shared.js';
import { ClientLicenseManager, type ClientLicenseSnapshot } from './client-license.js';
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
import {
  protectTranslationSensitiveTokens,
  restoreTranslationSensitiveTokens
} from './translation-sensitive-tokens.js';
import {
  decryptTranslationPromptBundle,
  encryptTranslationPromptBundle,
  translationPromptBundleFileName,
  type TranslationPrompts
} from './translation-prompt-bundle.js';
import { normalizeComposerEnglishStyle } from './translation-english-style.js';
import {
  decryptSmartReplyPromptBundle,
  encryptSmartReplyPromptBundle,
  smartReplyPromptBundleFileName,
  type SmartReplyPrompt
} from './smart-reply-prompt-bundle.js';
import {
  buildProtectedSmartReplyTranscript,
  parseSmartReplyResponse,
  validateSmartReplyRequest
} from './smart-reply-core.js';
import {
  inspectWindowsRemoteAccess,
  remoteGuardProcessScanIntervalMs,
  requestWindowsWorkstationLock
} from './remote-guard.js';

const defaultModel = 'deepseek-v4-flash';
const appDisplayName = 'maoyi';
const appUserDataDirName = 'maoyi';
const appDataFolderName = 'maoyi Data';
const storageBootstrapDirName = 'maoyi Launcher';
const windowsAppUserModelId = 'Maoyi.Translator';
const legacyUserDataDirName = 'chat-translator';
const __dirname = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(__dirname, '../electron/preload.cjs');
const cloneResetPlanPath = cloneResetPlanPathFromArgs();
const cloneResetWorkerMode = Boolean(cloneResetPlanPath);
const developmentProjectRoot = resolve(app.getAppPath());
const signalSourceExperimentValue = !app.isPackaged
  ? process.env.MAOYI_SIGNAL_SOURCE_EXE?.trim() || ''
  : '';
const supportedSignalSourcePatchSets: Readonly<Record<string, string>> = Object.freeze({
  '8.17.0': '6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052',
  '8.18.0': 'BF482ACA5FEB79AFD4B0C418E56DF41BEA3C38F284EF8FBDB64C1BF17F5D2650'
});
const signalSourceOnlyAcceptanceValue =
  process.env.MAOYI_SIGNAL_SOURCE_ONLY_ACCEPTANCE?.trim() || '';
if (signalSourceOnlyAcceptanceValue && !['0', '1'].includes(signalSourceOnlyAcceptanceValue)) {
  throw new Error('MAOYI_SIGNAL_SOURCE_ONLY_ACCEPTANCE must be 0 or 1.');
}
const signalSourceOnlyAcceptanceRequested = signalSourceOnlyAcceptanceValue === '1';
let signalSourceExperimentMetadata: {
  version: string;
  patchSetSha256: string;
  isolatedRuntimeCopy: boolean;
} | null = null;
let signalSourceOnlyAcceptanceActive = false;

function resolveSignalSourceOnlyAcceptance() {
  if (!signalSourceOnlyAcceptanceRequested) return false;
  const hasConflictingMode = Boolean(
    cloneResetWorkerMode ||
      process.env.VITE_DEV_SERVER_URL ||
      process.argv.some(argument => argument.startsWith('--remote-debugging-')) ||
      Object.keys(process.env).some(name => name.startsWith('MAOYI_SMOKE_') && process.env[name])
  );
  if (
    app.isPackaged ||
    process.platform !== 'win32' ||
    !signalSourceExperimentValue ||
    hasConflictingMode
  ) {
    throw new Error('Signal source-only acceptance requires an isolated Windows source experiment.');
  }
  signalExecutableCandidates();
  if (
    signalSourceExperimentMetadata?.version !== '8.18.0' ||
    signalSourceExperimentMetadata.patchSetSha256 !== supportedSignalSourcePatchSets['8.18.0'] ||
    !signalSourceExperimentMetadata.isolatedRuntimeCopy
  ) {
    throw new Error('Signal source-only acceptance requires the exact isolated v8.18.0 patch set.');
  }
  return true;
}

function isCanonicalChildPath(rootPath: string, targetPath: string) {
  const childPath = relative(rootPath, targetPath);
  return Boolean(
    childPath &&
      childPath !== '..' &&
      !childPath.startsWith(`..${sep}`) &&
      !isAbsolute(childPath)
  );
}

function assertCanonicalChildPath(rootPath: string, targetPath: string, label: string) {
  if (!isCanonicalChildPath(rootPath, targetPath)) {
    throw new Error(`${label} must stay inside ${rootPath}.`);
  }
}

function canonicalRealDirectory(path: string, label: string) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  return realpathSync.native(path);
}

function validateSignalSourceExperimentUserData(userDataPath: string) {
  if (!userDataPath || !isAbsolute(userDataPath)) {
    throw new Error('Signal source experiments require an absolute MAOYI_USER_DATA_DIR.');
  }
  const allowedRoot = join(developmentProjectRoot, '.tmp', 'signal-source-ui');
  const canonicalRoot = canonicalRealDirectory(allowedRoot, 'Signal source experiment root');
  const canonicalUserData = realpathSync.native(userDataPath);
  if (lstatSync(userDataPath).isSymbolicLink() || !statSync(canonicalUserData).isDirectory()) {
    throw new Error('Signal source experiment user data must be a real directory.');
  }
  assertCanonicalChildPath(canonicalRoot, canonicalUserData, 'Signal source experiment user data');
}

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

const whatsappUserAgent = buildWindowsChromiumUserAgent(process.versions.chrome);
const telegramUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.243 Safari/537.36';
const defaultBrowserUserAgent = whatsappUserAgent;
const userDataOverride = process.env.MAOYI_USER_DATA_DIR?.trim() || '';
if (signalSourceExperimentValue) {
  validateSignalSourceExperimentUserData(userDataOverride);
}
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
const remoteGuardScanIntervalMs = 8_000;
const remoteGuardWindowsLockDelayMs = 3_000;
let remoteGuardStatus: RemoteGuardStatus = {
  enabled: process.platform === 'win32',
  state: 'starting',
  checkedAt: 0,
  nextScanAt: 0,
  scanDurationMs: 0,
  scanIntervalMs: remoteGuardScanIntervalMs,
  processScanIntervalMs: remoteGuardProcessScanIntervalMs,
  windowsLockDelayMs: remoteGuardWindowsLockDelayMs,
  threatActive: false,
  incidentLatched: false,
  windowsSessionLocked: false,
  windowsLockState: 'idle',
  findings: [],
  coverage: { windowsSessions: false, processes: false, connections: 'not-needed' }
};
let remoteGuardStarted = false;
let remoteGuardThreatActive = false;
let remoteGuardIncidentLatched = false;
let remoteGuardScanTimer: NodeJS.Timeout | null = null;
let remoteGuardScanPromise: Promise<RemoteGuardStatus> | null = null;
let remoteGuardWindowsLockTimer: NodeJS.Timeout | null = null;
let remoteGuardBeepTimer: NodeJS.Timeout | null = null;
let remoteGuardVisibilityLockPromise: Promise<void> | null = null;
let remoteGuardLastClearState: RemoteGuardState = 'starting';
let remoteGuardRuntimeReason = '';
const remoteGuardAlarmWindows = new Set<BrowserWindow>();
let clientLicenseManager: ClientLicenseManager | null = null;
let authorizedRuntimePrepared = false;
let activeRuntimeSecurity: { payload: RuntimeBindingPayload; devicePrivateKeyPem: string } | null = null;
const configuredPartitions = new Set<string>();
const partitionPolicies = new Map<string, Platform>();
const sessionPolicies = new Map<Session, Platform>();
const translationCacheWriteQueues = new Map<string, Promise<boolean>>();
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
type PendingSignalCacheSnapshotRequest = {
  requestId: string;
  conversationId: string;
  client: SignalControlClient;
  state: 'pending' | 'responding' | 'completed';
  acceptanceTrigger?: {
    messageId: string;
    sourceHash: string;
    resultSent: boolean;
    forceCacheResult?: boolean;
    refreshTaskKey?: string;
  };
};
type ActiveSignalCacheConversation = {
  conversationId: string;
  client: SignalControlClient;
};
const signalCachePendingRequestLimit = 128;
const signalCacheInFlightRequestLimit = 8;
const pendingSignalCacheSnapshotRequests = new Map<
  string,
  Map<string, PendingSignalCacheSnapshotRequest>
>();
const signalCacheInFlightRequestCounts = new Map<string, number>();
const activeSignalCacheConversations = new Map<string, ActiveSignalCacheConversation>();
type PendingSignalSmartReplyRequest = {
  requestId: string;
  conversationId: string;
  trigger: SignalVisibleMessage;
  client: SignalControlClient;
  state: 'generating' | 'completed';
  acceptedAt: number;
};
const signalSmartReplyPendingRequestLimit = 64;
const signalSmartReplyRequestTtlMs = 30_000;
const pendingSignalSmartReplyRequests = new Map<
  string,
  Map<string, PendingSignalSmartReplyRequest>
>();

// SIGNAL_SOURCE_ONLY_ACCEPTANCE_DIAGNOSTICS_START
const signalSourceOnlyAcceptanceStageCounts = Object.fromEntries(
  signalSourceOnlyAcceptanceStages.map(stage => [stage, 0])
) as SignalSourceOnlyAcceptanceStageCounts;
let signalSourceOnlyAcceptanceStartedAt = 0;
let signalSourceOnlyAcceptanceSummaryWriteQueue: Promise<void> = Promise.resolve();

function initializeSignalSourceOnlyAcceptanceDiagnostics() {
  for (const stage of signalSourceOnlyAcceptanceStages) {
    signalSourceOnlyAcceptanceStageCounts[stage] = 0;
  }
  signalSourceOnlyAcceptanceStartedAt = Date.now();
  appendSignalSourceOnlyAcceptanceStage('mode-active');
}

function appendSignalSourceOnlyAcceptanceStage(
  stage: SignalSourceOnlyAcceptanceStage
) {
  if (!signalSourceOnlyAcceptanceActive || !runtimeLoggingEnabled) return;
  signalSourceOnlyAcceptanceStageCounts[stage] += 1;
  const summary = buildSignalSourceOnlyAcceptanceDiagnostic(
    stage,
    signalSourceOnlyAcceptanceStageCounts,
    Math.max(0, Date.now() - signalSourceOnlyAcceptanceStartedAt)
  );
  signalSourceOnlyAcceptanceSummaryWriteQueue = signalSourceOnlyAcceptanceSummaryWriteQueue
    .catch(() => undefined)
    .then(async () => {
      await mkdir(app.getPath('userData'), { recursive: true });
      await writeJsonAtomic(signalSourceOnlyAcceptanceSummaryPath(), summary);
    });
}
// SIGNAL_SOURCE_ONLY_ACCEPTANCE_DIAGNOSTICS_END

// SIGNAL_LIVE_TRANSLATION_QUEUE_START
const signalLiveTranslationGlobalConcurrency = 24;
const signalLiveTranslationProfileConcurrency = 1;
const signalLiveTranslationPendingLimit = signalCachePendingRequestLimit;
const signalLiveTranslationSourceTextLimit = 4_000;
const signalLiveTranslationRefreshCoalesceMs = 100;
const signalLiveTranslationRetryDelaysMs = [5_000, 30_000] as const;
const signalTranslationRefreshCooldownMs = 1_500;
const signalTranslationRefreshStateLimit = 512;

type SignalLiveTranslationMode = 'live' | 'manual-refresh';

type SignalLiveTranslationTask = {
  key: string;
  mode: SignalLiveTranslationMode;
  appId: string;
  profileId: string;
  conversationId: string;
  client: SignalControlClient;
  messageId: string;
  sourceHash: string;
  sourceText: string;
  direction: 'incoming' | 'outgoing';
  attempts: number;
  createdAt: number;
  cancelled: boolean;
  abortController: AbortController;
  translatedText?: string;
  refreshIdentityKey?: string;
  refreshProjectionKey?: string;
  refreshRevision?: number;
};

type SignalLiveTranslationRetry = {
  task: SignalLiveTranslationTask;
  timer: NodeJS.Timeout;
};

type SignalLiveTranslationRefresh = {
  appId: string;
  task: SignalLiveTranslationTask;
  timer: NodeJS.Timeout;
};

type SignalTranslationRefreshState = {
  appId: string;
  revision: number;
  projectionKey: string;
  acceptedAt: number;
  taskKey: string;
};

type SignalTranslationRefreshObservation = {
  taskKey?: string;
  pending: boolean;
};

const signalLiveTranslationQueue: SignalLiveTranslationTask[] = [];
const signalLiveTranslationPendingKeys = new Set<string>();
const signalLiveTranslationRetryTimers = new Map<string, SignalLiveTranslationRetry>();
const signalLiveTranslationRunningProfiles = new Map<string, number>();
const signalLiveTranslationRunningTasks = new Map<string, SignalLiveTranslationTask>();
const signalLiveTranslationRefreshTimers = new Map<string, SignalLiveTranslationRefresh>();
const signalTranslationRefreshStates = new Map<string, SignalTranslationRefreshState>();
let signalLiveTranslationRunningCount = 0;
let signalLiveTranslationPumpTimer: NodeJS.Timeout | null = null;

function signalLiveTranslationTaskKey(
  profileId: string,
  conversationId: string,
  messageId: string,
  sourceHash: string,
  sourceText: string
) {
  const exactSourceDigest = createHash('sha256')
    .update(normalizeSignalCacheSourceText(sourceText), 'utf8')
    .digest('base64url');
  return JSON.stringify([
    profileId,
    conversationId,
    messageId,
    sourceHash,
    exactSourceDigest
  ]);
}

function signalTranslationRefreshIdentityKey(
  profileId: string,
  conversationId: string,
  messageId: string
) {
  return JSON.stringify([profileId, conversationId, messageId]);
}

function signalTranslationRefreshProjectionKey(message: SignalVisibleMessage) {
  const exactSourceDigest = createHash('sha256')
    .update(normalizeSignalCacheSourceText(message.sourceText), 'utf8')
    .digest('base64url');
  return JSON.stringify([
    message.sourceHash,
    exactSourceDigest,
    message.direction,
    message.timestamp
  ]);
}

function observeSignalTranslationRefresh(
  profileId: string,
  conversationId: string,
  messageId: string
): SignalTranslationRefreshObservation {
  const state = signalTranslationRefreshStates.get(
    signalTranslationRefreshIdentityKey(profileId, conversationId, messageId)
  );
  return {
    taskKey: state?.taskKey,
    pending: Boolean(state?.taskKey && signalLiveTranslationPendingKeys.has(state.taskKey))
  };
}

function isSignalTranslationRefreshObservationSettled(
  profileId: string,
  conversationId: string,
  messageId: string,
  observed: SignalTranslationRefreshObservation
) {
  const current = observeSignalTranslationRefresh(profileId, conversationId, messageId);
  return Boolean(
    !observed.pending &&
      !current.pending &&
      observed.taskKey === current.taskKey
  );
}

function isSignalTranslationRefreshTriggerCurrent(
  profileId: string,
  pending: PendingSignalCacheSnapshotRequest
) {
  const refreshTaskKey = pending.acceptanceTrigger?.refreshTaskKey;
  if (!refreshTaskKey || !pending.acceptanceTrigger) return true;
  return observeSignalTranslationRefresh(
    profileId,
    pending.conversationId,
    pending.acceptanceTrigger.messageId
  ).taskKey === refreshTaskKey;
}

function sameSignalLiveTranslationMessage(
  task: SignalLiveTranslationTask,
  appId: string,
  conversationId: string,
  messageId: string
) {
  return Boolean(
    task.appId === appId &&
      task.conversationId === conversationId &&
      task.messageId === messageId
  );
}

function cancelSignalLiveTranslationTask(task: SignalLiveTranslationTask) {
  task.cancelled = true;
  task.abortController.abort();
  signalLiveTranslationPendingKeys.delete(task.key);
}

function hasSignalLiveTranslationForMessage(
  appId: string,
  conversationId: string,
  messageId: string
) {
  return Boolean(
    signalLiveTranslationQueue.some(task =>
      sameSignalLiveTranslationMessage(task, appId, conversationId, messageId)
    ) ||
      Array.from(signalLiveTranslationRetryTimers.values()).some(({ task }) =>
        sameSignalLiveTranslationMessage(task, appId, conversationId, messageId)
      ) ||
      Array.from(signalLiveTranslationRunningTasks.values()).some(task =>
        sameSignalLiveTranslationMessage(task, appId, conversationId, messageId)
      )
  );
}

function cancelSignalLiveTranslationsForMessage(
  appId: string,
  conversationId: string,
  messageId: string
) {
  for (let index = signalLiveTranslationQueue.length - 1; index >= 0; index -= 1) {
    const task = signalLiveTranslationQueue[index];
    if (!sameSignalLiveTranslationMessage(task, appId, conversationId, messageId)) continue;
    signalLiveTranslationQueue.splice(index, 1);
    cancelSignalLiveTranslationTask(task);
  }
  for (const [key, retry] of signalLiveTranslationRetryTimers) {
    if (!sameSignalLiveTranslationMessage(retry.task, appId, conversationId, messageId)) continue;
    clearTimeout(retry.timer);
    signalLiveTranslationRetryTimers.delete(key);
    cancelSignalLiveTranslationTask(retry.task);
  }
  for (const task of signalLiveTranslationRunningTasks.values()) {
    if (!sameSignalLiveTranslationMessage(task, appId, conversationId, messageId)) continue;
    cancelSignalLiveTranslationTask(task);
  }
  for (const [key, refresh] of signalLiveTranslationRefreshTimers) {
    if (!sameSignalLiveTranslationMessage(refresh.task, appId, conversationId, messageId)) continue;
    clearTimeout(refresh.timer);
    signalLiveTranslationRefreshTimers.delete(key);
  }
}

function trimSignalTranslationRefreshStates() {
  while (signalTranslationRefreshStates.size > signalTranslationRefreshStateLimit) {
    let evicted = false;
    for (const [key, state] of signalTranslationRefreshStates) {
      if (state.taskKey && signalLiveTranslationPendingKeys.has(state.taskKey)) continue;
      signalTranslationRefreshStates.delete(key);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

function cancelSignalLiveTranslationsForApp(appId: string) {
  for (let index = signalLiveTranslationQueue.length - 1; index >= 0; index -= 1) {
    const task = signalLiveTranslationQueue[index];
    if (task.appId !== appId) continue;
    signalLiveTranslationQueue.splice(index, 1);
    cancelSignalLiveTranslationTask(task);
  }
  for (const [key, retry] of signalLiveTranslationRetryTimers) {
    if (retry.task.appId !== appId) continue;
    clearTimeout(retry.timer);
    signalLiveTranslationRetryTimers.delete(key);
    cancelSignalLiveTranslationTask(retry.task);
  }
  for (const task of signalLiveTranslationRunningTasks.values()) {
    if (task.appId !== appId) continue;
    cancelSignalLiveTranslationTask(task);
  }
  for (const [key, refresh] of signalLiveTranslationRefreshTimers) {
    if (refresh.appId !== appId) continue;
    clearTimeout(refresh.timer);
    signalLiveTranslationRefreshTimers.delete(key);
  }
  for (const [key, state] of signalTranslationRefreshStates) {
    if (state.appId === appId) signalTranslationRefreshStates.delete(key);
  }
}

function cancelAllSignalLiveTranslations() {
  const appIds = new Set<string>();
  for (const task of signalLiveTranslationQueue) appIds.add(task.appId);
  for (const retry of signalLiveTranslationRetryTimers.values()) appIds.add(retry.task.appId);
  for (const task of signalLiveTranslationRunningTasks.values()) appIds.add(task.appId);
  for (const refresh of signalLiveTranslationRefreshTimers.values()) appIds.add(refresh.appId);
  for (const state of signalTranslationRefreshStates.values()) appIds.add(state.appId);
  for (const appId of appIds) cancelSignalLiveTranslationsForApp(appId);
}

function isSignalLiveTranslationEligible(task: SignalLiveTranslationTask) {
  const context = getSignalCacheControlContext(task.appId, task.client);
  const activeConversation = activeSignalCacheConversations.get(task.appId);
  const refreshState = task.mode === 'manual-refresh' && task.refreshIdentityKey
    ? signalTranslationRefreshStates.get(task.refreshIdentityKey)
    : undefined;
  return Boolean(
    !task.cancelled &&
      context?.profileId === task.profileId &&
      activeConversation?.client === task.client &&
      activeConversation.conversationId === task.conversationId &&
      (
        task.mode !== 'manual-refresh' ||
        (
          refreshState?.revision === task.refreshRevision &&
          refreshState?.projectionKey === task.refreshProjectionKey
        )
      )
  );
}

function signalLiveTranslationRefreshKey(task: SignalLiveTranslationTask) {
  return task.mode === 'manual-refresh' ? task.key : task.appId;
}

function scheduleSignalLiveTranslationRefresh(task: SignalLiveTranslationTask) {
  if (!isSignalLiveTranslationEligible(task)) return;
  const refreshKey = signalLiveTranslationRefreshKey(task);
  const existing = signalLiveTranslationRefreshTimers.get(refreshKey);
  if (
    existing?.task.client === task.client &&
    existing.task.conversationId === task.conversationId &&
    isSignalLiveTranslationEligible(existing.task)
  ) {
    return;
  }
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    const scheduled = signalLiveTranslationRefreshTimers.get(refreshKey);
    if (
      scheduled?.timer !== timer ||
      scheduled.task !== task
    ) {
      return;
    }
    signalLiveTranslationRefreshTimers.delete(refreshKey);
    if (!isSignalLiveTranslationEligible(task)) return;
    const snapshotRequest = validateSignalMessageSnapshotRequest({
      type: 'message.snapshot.request',
      requestId: randomUUID()
    });
    const pendingStored = setPendingSignalCacheRequest(task.appId, {
      requestId: snapshotRequest.requestId,
      conversationId: task.conversationId,
      client: task.client,
      state: 'pending',
      acceptanceTrigger: task.mode === 'manual-refresh' || signalSourceOnlyAcceptanceActive
        ? {
            messageId: task.messageId,
            sourceHash: task.sourceHash,
            resultSent: false,
            forceCacheResult: task.mode === 'manual-refresh',
            refreshTaskKey: task.mode === 'manual-refresh' ? task.key : undefined
          }
        : undefined
    });
    if (!pendingStored) return;
    if (!sendSignalControlMessage(task.appId, snapshotRequest)) {
      deletePendingSignalCacheRequest(task.appId, snapshotRequest.requestId);
      return;
    }
    appendSignalSourceOnlyAcceptanceStage('snapshot-request-sent');
  }, signalLiveTranslationRefreshCoalesceMs);
  signalLiveTranslationRefreshTimers.set(refreshKey, {
    appId: task.appId,
    task,
    timer
  });
}

async function runSignalLiveTranslationTask(task: SignalLiveTranslationTask) {
  const forceRefresh = task.mode === 'manual-refresh';
  const cacheRequest: TranslationCacheLookupRequest = {
    profileId: task.profileId,
    platform: 'signal',
    contactId: task.conversationId,
    contactIdType: 'platform',
    sourceHashes: [task.sourceHash]
  };
  if (!isSignalLiveTranslationEligible(task)) return;
  if (!forceRefresh) {
    if (await isMarkedNonEnglishContact(cacheRequest)) return;
    if (!isSignalLiveTranslationEligible(task)) return;

    appendSignalSourceOnlyAcceptanceStage('cache-lookup');
    const cachedEntries = await lookupTranslationCache(cacheRequest);
    if (!isSignalLiveTranslationEligible(task)) return;
    const cached = cachedEntries.find(entry => entry.sourceHash === task.sourceHash);
    if (
      cached &&
      typeof cached.sourceText === 'string' &&
      normalizeSignalCacheSourceText(cached.sourceText) ===
        normalizeSignalCacheSourceText(task.sourceText) &&
      isUsefulSignalCacheTranslation(task.sourceText, cached.translatedText)
    ) {
      appendSignalSourceOnlyAcceptanceStage('cache-hit');
      scheduleSignalLiveTranslationRefresh(task);
      return;
    }
  }

  if (!task.translatedText) {
    appendSignalSourceOnlyAcceptanceStage('api-start');
    const translatedText = await translateWithDeepSeek(
      {
        requestId: randomUUID(),
        text: task.sourceText,
        from: 'English',
        to: 'Chinese',
        reason: 'visible-message',
        profileId: task.profileId,
        platform: 'signal',
        sourceHash: task.sourceHash,
        messageKey: task.messageId,
        contactId: task.conversationId,
        contactIdType: 'platform',
        direction: task.direction,
        messagePart: 'body'
      },
      task.abortController.signal,
      'content-free'
    );
    if (!isSignalLiveTranslationEligible(task)) return;
    if (
      !isUsefulSignalCacheTranslation(task.sourceText, translatedText) ||
      Buffer.byteLength(translatedText, 'utf8') > signalCacheProtocolMaxTextBytes
    ) {
      throw new Error('Signal live translation result is invalid.');
    }
    task.translatedText = translatedText;
    appendSignalSourceOnlyAcceptanceStage('api-success');
  }

  if (!forceRefresh && await isMarkedNonEnglishContact(cacheRequest)) return;
  if (!isSignalLiveTranslationEligible(task)) return;
  const saved = await saveTranslationCacheEntry(
    {
      profileId: task.profileId,
      sourceHash: task.sourceHash,
      sourceText: task.sourceText,
      translatedText: task.translatedText,
      platform: 'signal',
      contactId: task.conversationId,
      contactIdType: 'platform',
      direction: task.direction,
      messagePart: 'body'
    },
    () => isSignalLiveTranslationEligible(task),
    { bypassNonEnglishContactGuard: forceRefresh }
  );
  if (!saved || !isSignalLiveTranslationEligible(task)) return;
  appendSignalSourceOnlyAcceptanceStage('cache-saved');
  scheduleSignalLiveTranslationRefresh(task);
}

function finishSignalLiveTranslationTask(task: SignalLiveTranslationTask) {
  signalLiveTranslationPendingKeys.delete(task.key);
  signalLiveTranslationRetryTimers.delete(task.key);
  trimSignalTranslationRefreshStates();
}

function releaseSignalLiveTranslationSlot(task: SignalLiveTranslationTask) {
  signalLiveTranslationRunningTasks.delete(task.key);
  signalLiveTranslationRunningCount = Math.max(0, signalLiveTranslationRunningCount - 1);
  const profileCount = signalLiveTranslationRunningProfiles.get(task.profileId) ?? 0;
  if (profileCount <= 1) {
    signalLiveTranslationRunningProfiles.delete(task.profileId);
  } else {
    signalLiveTranslationRunningProfiles.set(task.profileId, profileCount - 1);
  }
}

function scheduleSignalLiveTranslationPump() {
  if (signalLiveTranslationPumpTimer) return;
  signalLiveTranslationPumpTimer = setTimeout(() => {
    signalLiveTranslationPumpTimer = null;
    pumpSignalLiveTranslationQueue();
  }, 0);
}

function scheduleSignalLiveTranslationRetry(task: SignalLiveTranslationTask) {
  const retryDelay = signalLiveTranslationRetryDelaysMs[task.attempts];
  if (retryDelay === undefined || !isSignalLiveTranslationEligible(task)) {
    appendSignalSourceOnlyAcceptanceStage('failed');
    finishSignalLiveTranslationTask(task);
    return;
  }
  const retryTask = {
    ...task,
    attempts: task.attempts + 1,
    createdAt: Date.now() + retryDelay
  };
  appendSignalSourceOnlyAcceptanceStage('retry-scheduled');
  const timer = setTimeout(() => {
    const retry = signalLiveTranslationRetryTimers.get(task.key);
    if (retry?.timer !== timer) return;
    signalLiveTranslationRetryTimers.delete(task.key);
    if (!isSignalLiveTranslationEligible(retryTask)) {
      finishSignalLiveTranslationTask(retryTask);
      return;
    }
    signalLiveTranslationQueue.push(retryTask);
    scheduleSignalLiveTranslationPump();
  }, retryDelay);
  signalLiveTranslationRetryTimers.set(task.key, { task: retryTask, timer });
}

function pumpSignalLiveTranslationQueue() {
  signalLiveTranslationQueue.sort((left, right) => {
    if (left.mode !== right.mode) return left.mode === 'manual-refresh' ? -1 : 1;
    return left.createdAt - right.createdAt;
  });
  while (
    signalLiveTranslationQueue.length > 0 &&
    signalLiveTranslationRunningCount < signalLiveTranslationGlobalConcurrency
  ) {
    const nextIndex = signalLiveTranslationQueue.findIndex(
      task =>
        (signalLiveTranslationRunningProfiles.get(task.profileId) ?? 0) <
        signalLiveTranslationProfileConcurrency
    );
    if (nextIndex < 0) return;
    const [task] = signalLiveTranslationQueue.splice(nextIndex, 1);
    if (!isSignalLiveTranslationEligible(task)) {
      finishSignalLiveTranslationTask(task);
      continue;
    }
    signalLiveTranslationRunningCount += 1;
    signalLiveTranslationRunningProfiles.set(
      task.profileId,
      (signalLiveTranslationRunningProfiles.get(task.profileId) ?? 0) + 1
    );
    signalLiveTranslationRunningTasks.set(task.key, task);
    void runSignalLiveTranslationTask(task)
      .then(() => {
        releaseSignalLiveTranslationSlot(task);
        finishSignalLiveTranslationTask(task);
        scheduleSignalLiveTranslationPump();
      })
      .catch(() => {
        releaseSignalLiveTranslationSlot(task);
        scheduleSignalLiveTranslationRetry(task);
        scheduleSignalLiveTranslationPump();
      });
  }
}

function enqueueSignalLiveTranslation(
  appId: string,
  profileId: string,
  client: SignalControlClient,
  message: SignalVisibleMessage
) {
  if (
    message.sourceText.length > signalLiveTranslationSourceTextLimit ||
    !isValidSignalTranslationProjection(message) ||
    signalLiveTranslationPendingKeys.size >= signalLiveTranslationPendingLimit
  ) {
    return false;
  }
  const key = signalLiveTranslationTaskKey(
    profileId,
    message.conversationId,
    message.messageId,
    message.sourceHash,
    message.sourceText
  );
  if (signalLiveTranslationPendingKeys.has(key)) return false;
  const task: SignalLiveTranslationTask = {
    key,
    mode: 'live',
    appId,
    profileId,
    conversationId: message.conversationId,
    client,
    messageId: message.messageId,
    sourceHash: message.sourceHash,
    sourceText: message.sourceText,
    direction: message.direction,
    attempts: 0,
    createdAt: Date.now(),
    cancelled: false,
    abortController: new AbortController()
  };
  if (!isSignalLiveTranslationEligible(task)) return false;
  signalLiveTranslationPendingKeys.add(key);
  signalLiveTranslationQueue.push(task);
  scheduleSignalLiveTranslationPump();
  return true;
}

function enqueueSignalTranslationRefresh(
  appId: string,
  profileId: string,
  client: SignalControlClient,
  message: SignalVisibleMessage
) {
  if (
    message.sourceText.length > signalLiveTranslationSourceTextLimit ||
    !isValidSignalTranslationProjection(message)
  ) {
    return false;
  }

  const identityKey = signalTranslationRefreshIdentityKey(
    profileId,
    message.conversationId,
    message.messageId
  );
  const projectionKey = signalTranslationRefreshProjectionKey(message);
  const previousState = signalTranslationRefreshStates.get(identityKey);
  const now = Date.now();
  if (
    previousState?.projectionKey === projectionKey &&
    now - previousState.acceptedAt < signalTranslationRefreshCooldownMs
  ) {
    return false;
  }

  const hasSupersededTask = hasSignalLiveTranslationForMessage(
    appId,
    message.conversationId,
    message.messageId
  );
  if (
    signalLiveTranslationPendingKeys.size >= signalLiveTranslationPendingLimit &&
    !hasSupersededTask
  ) {
    return false;
  }
  cancelSignalLiveTranslationsForMessage(
    appId,
    message.conversationId,
    message.messageId
  );
  if (signalLiveTranslationPendingKeys.size >= signalLiveTranslationPendingLimit) return false;

  const revision = previousState && previousState.revision < Number.MAX_SAFE_INTEGER
    ? previousState.revision + 1
    : 1;
  const baseKey = signalLiveTranslationTaskKey(
    profileId,
    message.conversationId,
    message.messageId,
    message.sourceHash,
    message.sourceText
  );
  const key = JSON.stringify(['manual-refresh', baseKey, revision, randomUUID()]);
  const task: SignalLiveTranslationTask = {
    key,
    mode: 'manual-refresh',
    appId,
    profileId,
    conversationId: message.conversationId,
    client,
    messageId: message.messageId,
    sourceHash: message.sourceHash,
    sourceText: message.sourceText,
    direction: message.direction,
    attempts: 0,
    createdAt: now,
    cancelled: false,
    abortController: new AbortController(),
    refreshIdentityKey: identityKey,
    refreshProjectionKey: projectionKey,
    refreshRevision: revision
  };
  signalTranslationRefreshStates.delete(identityKey);
  signalTranslationRefreshStates.set(identityKey, {
    appId,
    revision,
    projectionKey,
    acceptedAt: now,
    taskKey: key
  });
  trimSignalTranslationRefreshStates();
  if (!isSignalLiveTranslationEligible(task)) {
    signalTranslationRefreshStates.delete(identityKey);
    return false;
  }
  signalLiveTranslationPendingKeys.add(key);
  signalLiveTranslationQueue.push(task);
  scheduleSignalLiveTranslationPump();
  return true;
}
// SIGNAL_LIVE_TRANSLATION_QUEUE_END

function clearSignalCacheRequestState(appId: string) {
  pendingSignalCacheSnapshotRequests.delete(appId);
  pendingSignalSmartReplyRequests.delete(appId);
  activeSignalCacheConversations.delete(appId);
  cancelSignalLiveTranslationsForApp(appId);
}

function clearAllSignalCacheRequestState() {
  pendingSignalCacheSnapshotRequests.clear();
  pendingSignalSmartReplyRequests.clear();
  activeSignalCacheConversations.clear();
  cancelAllSignalLiveTranslations();
}

function setPendingSignalSmartReplyRequest(
  appId: string,
  pending: PendingSignalSmartReplyRequest
) {
  let requests = pendingSignalSmartReplyRequests.get(appId);
  if (!requests) {
    requests = new Map();
    pendingSignalSmartReplyRequests.set(appId, requests);
  }
  if (requests.has(pending.requestId)) return false;
  const now = Date.now();
  for (const [requestId, request] of requests) {
    if (now - request.acceptedAt > signalSmartReplyRequestTtlMs) {
      requests.delete(requestId);
    }
  }
  if (requests.size >= signalSmartReplyPendingRequestLimit) {
    const completedRequestId = Array.from(requests.entries())
      .find(([, request]) => request.state === 'completed')?.[0];
    if (!completedRequestId) return false;
    requests.delete(completedRequestId);
  }
  if (Array.from(requests.values()).some(request => request.state === 'generating')) return false;
  requests.set(pending.requestId, pending);
  return true;
}

function getPendingSignalSmartReplyRequest(appId: string, requestId: string) {
  return pendingSignalSmartReplyRequests.get(appId)?.get(requestId);
}

function getPendingSignalCacheRequest(appId: string, requestId: string) {
  return pendingSignalCacheSnapshotRequests.get(appId)?.get(requestId);
}

function setPendingSignalCacheRequest(
  appId: string,
  pending: PendingSignalCacheSnapshotRequest
) {
  let requests = pendingSignalCacheSnapshotRequests.get(appId);
  if (!requests) {
    requests = new Map();
    pendingSignalCacheSnapshotRequests.set(appId, requests);
  }
  if (requests.has(pending.requestId)) return false;
  if (requests.size >= signalCachePendingRequestLimit) {
    let oldestPendingRequestId: string | undefined;
    let evictableRequestId: string | undefined;
    for (const [requestId, request] of requests) {
      if (request.state === 'completed') {
        evictableRequestId = requestId;
        break;
      }
      if (request.state === 'pending' && !oldestPendingRequestId) {
        oldestPendingRequestId = requestId;
      }
    }
    evictableRequestId ??= oldestPendingRequestId;
    if (!evictableRequestId) return false;
    requests.delete(evictableRequestId);
  }
  requests.set(pending.requestId, pending);
  return true;
}

function deletePendingSignalCacheRequest(appId: string, requestId: string) {
  const requests = pendingSignalCacheSnapshotRequests.get(appId);
  if (!requests) return;
  requests.delete(requestId);
  if (requests.size === 0) pendingSignalCacheSnapshotRequests.delete(appId);
}

function tryAcquireSignalCacheLookupSlot(appId: string) {
  const count = signalCacheInFlightRequestCounts.get(appId) ?? 0;
  if (count >= signalCacheInFlightRequestLimit) return false;
  signalCacheInFlightRequestCounts.set(appId, count + 1);
  return true;
}

function releaseSignalCacheLookupSlot(appId: string) {
  const count = signalCacheInFlightRequestCounts.get(appId) ?? 0;
  if (count <= 1) {
    signalCacheInFlightRequestCounts.delete(appId);
    return;
  }
  signalCacheInFlightRequestCounts.set(appId, count - 1);
}
type SignalVisibilityAckWaiter = {
  revision: number;
  resolve: (applied: boolean) => void;
  timer: NodeJS.Timeout;
};
const signalVisibilityAckWaiters = new Map<string, SignalVisibilityAckWaiter>();
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
let workspaceVisibilityGate = { locked: true, revision: 0 };
const signalMoveSyncIntervalMs = 16;
const signalMoveFinalDelayMs = 48;
const signalControlHandshakeTimeoutMs = 5_000;
const signalControlMaxFrameBytes = 1024 * 1024;
const signalControlMaxSockets = 64;
const signalVisibilityAckTimeoutMs = 1_000;
const signalVisibilityShutdownGraceMs = 250;
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

// SIGNAL_CACHE_PROTOCOL_PURE_START
const signalCacheProtocolMaxBatchSize = 100;
const signalCacheProtocolMaxBusinessJsonBytes = 768 * 1024;
const signalCacheProtocolMaxTextBytes = 64 * 1024;
const signalCacheProtocolUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const signalCacheProtocolSourceHashPattern = /^(?:0|[1-9a-z][0-9a-z]{0,6})$/;
const signalCacheProtocolDirections = new Set(['incoming', 'outgoing'] as const);

type SignalConversationChangedMessage = {
  type: 'conversation.changed';
  conversationId: string;
};

type SignalVisibleMessage = {
  conversationId: string;
  messageId: string;
  sourceHash: string;
  sourceText: string;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
};

type SignalVisibleMessageBatch = {
  type: 'message.visibleBatch';
  requestId: string;
  conversationId: string;
  messages: SignalVisibleMessage[];
};

type SignalMessageAdded = SignalVisibleMessage & {
  type: 'message.added';
};

type SignalTranslationRefreshRequest = SignalVisibleMessage & {
  type: 'translation.refresh.request';
  requestId: string;
};

const signalSmartReplyContextVersion = 'df.signal.smart-reply-context.v1' as const;
const signalSmartReplyMaxMessages = 8;
const signalSmartReplyMaxTranscriptBytes = 8 * 1024;

type SignalSmartReplyRequest = {
  type: 'smartReply.request';
  requestId: string;
  contextVersion: typeof signalSmartReplyContextVersion;
  conversationId: string;
  triggerMessageId: string;
  messages: SignalVisibleMessage[];
};

type SignalSmartReplyErrorCode =
  | 'unavailable'
  | 'rate-limited'
  | 'timeout'
  | 'invalid-response'
  | 'request-failed';

type SignalCacheResult = {
  conversationId: string;
  messageId: string;
  sourceHash: string;
  sourceText: string;
  translatedText: string;
};

type SignalCacheResultBatch = {
  type: 'translation.cacheResultBatch';
  requestId: string;
  conversationId: string;
  results: SignalCacheResult[];
};

type SignalCacheResultAppliedMessage = {
  type: 'translation.cacheResultApplied';
  requestId: string;
  appliedCount: number;
};

type SignalMessageSnapshotRequest = {
  type: 'message.snapshot.request';
  requestId: string;
};

function signalProtocolRecord(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Signal cache protocol object is invalid.');
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpectedKeys.length ||
    actualKeys.some((key, index) => key !== sortedExpectedKeys[index])
  ) {
    throw new Error('Signal cache protocol fields are invalid.');
  }
  return record;
}

function stripSignalControlTransportMetadata(
  value: unknown,
  expectedAppId: string
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { appId, at, ...businessPayload } = value as Record<string, unknown>;
  if (
    appId !== expectedAppId ||
    !Number.isSafeInteger(at) ||
    Number(at) < 0 ||
    typeof businessPayload.type !== 'string'
  ) {
    return null;
  }
  return businessPayload;
}

function assertSignalProtocolBusinessJson(value: unknown) {
  let serialized = '';
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Signal cache protocol object is not serializable.');
  }
  if (
    typeof serialized !== 'string' ||
    Buffer.byteLength(serialized, 'utf8') > signalCacheProtocolMaxBusinessJsonBytes
  ) {
    throw new Error('Signal cache protocol object is too large.');
  }
}

function assertSignalProtocolUuid(value: unknown) {
  if (typeof value !== 'string' || !signalCacheProtocolUuidPattern.test(value)) {
    throw new Error('Signal cache protocol UUID is invalid.');
  }
  return value;
}

function assertSignalProtocolText(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > signalCacheProtocolMaxTextBytes
  ) {
    throw new Error('Signal cache protocol text is invalid.');
  }
  return value;
}

function assertSignalProtocolSourceHash(value: unknown) {
  if (typeof value !== 'string' || !signalCacheProtocolSourceHashPattern.test(value)) {
    throw new Error('Signal cache protocol source hash is invalid.');
  }
  return value;
}

function validateSignalConversationChangedMessage(value: unknown): SignalConversationChangedMessage {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, ['type', 'conversationId']);
  if (record.type !== 'conversation.changed') {
    throw new Error('Signal conversation change type is invalid.');
  }
  return {
    type: 'conversation.changed',
    conversationId: assertSignalProtocolUuid(record.conversationId)
  };
}

function validateSignalMessageSnapshotRequest(value: unknown): SignalMessageSnapshotRequest {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, ['type', 'requestId']);
  if (record.type !== 'message.snapshot.request') {
    throw new Error('Signal snapshot request type is invalid.');
  }
  return {
    type: 'message.snapshot.request',
    requestId: assertSignalProtocolUuid(record.requestId)
  };
}

function validateSignalVisibleMessageBatch(value: unknown): SignalVisibleMessageBatch {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, ['type', 'requestId', 'conversationId', 'messages']);
  if (record.type !== 'message.visibleBatch' || !Array.isArray(record.messages)) {
    throw new Error('Signal visible message batch is invalid.');
  }
  if (record.messages.length > signalCacheProtocolMaxBatchSize) {
    throw new Error('Signal visible message batch is too large.');
  }
  const requestId = assertSignalProtocolUuid(record.requestId);
  const conversationId = assertSignalProtocolUuid(record.conversationId);
  const messageIds = new Set<string>();
  const messages = record.messages.map((value) => {
    const message = signalProtocolRecord(value, [
      'conversationId',
      'messageId',
      'sourceHash',
      'sourceText',
      'direction',
      'timestamp'
    ]);
    const itemConversationId = assertSignalProtocolUuid(message.conversationId);
    const messageId = assertSignalProtocolUuid(message.messageId);
    if (itemConversationId !== conversationId) {
      throw new Error('Signal visible message conversation is invalid.');
    }
    const comparableMessageId = messageId.toLowerCase();
    if (messageIds.has(comparableMessageId)) {
      throw new Error('Signal visible message ID is duplicated.');
    }
    messageIds.add(comparableMessageId);
    if (!signalCacheProtocolDirections.has(message.direction as 'incoming' | 'outgoing')) {
      throw new Error('Signal visible message direction is invalid.');
    }
    if (!Number.isSafeInteger(message.timestamp) || Number(message.timestamp) < 0) {
      throw new Error('Signal visible message timestamp is invalid.');
    }
    return {
      conversationId: itemConversationId,
      messageId,
      sourceHash: assertSignalProtocolSourceHash(message.sourceHash),
      sourceText: assertSignalProtocolText(message.sourceText),
      direction: message.direction as 'incoming' | 'outgoing',
      timestamp: Number(message.timestamp)
    };
  });
  return { type: 'message.visibleBatch', requestId, conversationId, messages };
}

function validateSignalMessageAdded(value: unknown): SignalMessageAdded {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, [
    'type',
    'conversationId',
    'messageId',
    'sourceHash',
    'sourceText',
    'direction',
    'timestamp'
  ]);
  if (record.type !== 'message.added') {
    throw new Error('Signal added message type is invalid.');
  }
  const conversationId = assertSignalProtocolUuid(record.conversationId);
  const validated = validateSignalVisibleMessageBatch({
    type: 'message.visibleBatch',
    requestId: '00000000-0000-4000-8000-000000000000',
    conversationId,
    messages: [{
      conversationId,
      messageId: record.messageId,
      sourceHash: record.sourceHash,
      sourceText: record.sourceText,
      direction: record.direction,
      timestamp: record.timestamp
    }]
  });
  const [message] = validated.messages;
  if (!message) throw new Error('Signal added message is missing.');
  if (!isValidSignalTranslationProjection(message)) {
    throw new Error('Signal added message projection is invalid.');
  }
  return {
    type: 'message.added',
    ...message
  };
}

function validateSignalTranslationRefreshRequest(
  value: unknown
): SignalTranslationRefreshRequest {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, [
    'type',
    'requestId',
    'conversationId',
    'messageId',
    'sourceHash',
    'sourceText',
    'direction',
    'timestamp'
  ]);
  if (record.type !== 'translation.refresh.request') {
    throw new Error('Signal translation refresh request type is invalid.');
  }
  const requestId = assertSignalProtocolUuid(record.requestId);
  const conversationId = assertSignalProtocolUuid(record.conversationId);
  const validated = validateSignalVisibleMessageBatch({
    type: 'message.visibleBatch',
    requestId,
    conversationId,
    messages: [{
      conversationId,
      messageId: record.messageId,
      sourceHash: record.sourceHash,
      sourceText: record.sourceText,
      direction: record.direction,
      timestamp: record.timestamp
    }]
  });
  const [message] = validated.messages;
  if (!message || !isValidSignalTranslationProjection(message)) {
    throw new Error('Signal translation refresh projection is invalid.');
  }
  return {
    type: 'translation.refresh.request',
    requestId,
    ...message
  };
}

function validateSignalSmartReplyRequest(value: unknown): SignalSmartReplyRequest {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, [
    'type',
    'requestId',
    'contextVersion',
    'conversationId',
    'triggerMessageId',
    'messages'
  ]);
  if (
    record.type !== 'smartReply.request' ||
    record.contextVersion !== signalSmartReplyContextVersion ||
    !Array.isArray(record.messages) ||
    record.messages.length < 1 ||
    record.messages.length > signalSmartReplyMaxMessages
  ) {
    throw new Error('Signal smart reply request is invalid.');
  }
  const requestId = assertSignalProtocolUuid(record.requestId);
  const conversationId = assertSignalProtocolUuid(record.conversationId);
  const triggerMessageId = assertSignalProtocolUuid(record.triggerMessageId);
  const validated = validateSignalVisibleMessageBatch({
    type: 'message.visibleBatch',
    requestId,
    conversationId,
    messages: record.messages
  });
  let transcriptBytes = 0;
  let previousTimestamp = -1;
  for (const message of validated.messages) {
    if (!isValidSignalTranslationProjection(message)) {
      throw new Error('Signal smart reply message projection is invalid.');
    }
    transcriptBytes += Buffer.byteLength(message.sourceText, 'utf8');
    if (message.timestamp < previousTimestamp) {
      throw new Error('Signal smart reply message order is invalid.');
    }
    previousTimestamp = message.timestamp;
  }
  const trigger = validated.messages.at(-1);
  if (
    transcriptBytes > signalSmartReplyMaxTranscriptBytes ||
    !trigger ||
    trigger.direction !== 'incoming' ||
    trigger.messageId !== triggerMessageId
  ) {
    throw new Error('Signal smart reply trigger is invalid.');
  }
  return {
    type: 'smartReply.request',
    requestId,
    contextVersion: signalSmartReplyContextVersion,
    conversationId,
    triggerMessageId,
    messages: validated.messages
  };
}

function validateSignalCacheResultBatch(value: unknown): SignalCacheResultBatch {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, ['type', 'requestId', 'conversationId', 'results']);
  if (record.type !== 'translation.cacheResultBatch' || !Array.isArray(record.results)) {
    throw new Error('Signal cache result batch is invalid.');
  }
  if (record.results.length > signalCacheProtocolMaxBatchSize) {
    throw new Error('Signal cache result batch is too large.');
  }
  const requestId = assertSignalProtocolUuid(record.requestId);
  const conversationId = assertSignalProtocolUuid(record.conversationId);
  const messageIds = new Set<string>();
  const results = record.results.map((value) => {
    const result = signalProtocolRecord(value, [
      'conversationId',
      'messageId',
      'sourceHash',
      'sourceText',
      'translatedText'
    ]);
    const itemConversationId = assertSignalProtocolUuid(result.conversationId);
    const messageId = assertSignalProtocolUuid(result.messageId);
    if (itemConversationId !== conversationId) {
      throw new Error('Signal cache result conversation is invalid.');
    }
    const comparableMessageId = messageId.toLowerCase();
    if (messageIds.has(comparableMessageId)) {
      throw new Error('Signal cache result message ID is duplicated.');
    }
    messageIds.add(comparableMessageId);
    return {
      conversationId: itemConversationId,
      messageId,
      sourceHash: assertSignalProtocolSourceHash(result.sourceHash),
      sourceText: assertSignalProtocolText(result.sourceText),
      translatedText: assertSignalProtocolText(result.translatedText)
    };
  });
  return { type: 'translation.cacheResultBatch', requestId, conversationId, results };
}

function validateSignalCacheResultAppliedMessage(value: unknown): SignalCacheResultAppliedMessage {
  assertSignalProtocolBusinessJson(value);
  const record = signalProtocolRecord(value, ['type', 'requestId', 'appliedCount']);
  if (
    record.type !== 'translation.cacheResultApplied' ||
    !Number.isSafeInteger(record.appliedCount) ||
    Number(record.appliedCount) < 0 ||
    Number(record.appliedCount) > signalCacheProtocolMaxBatchSize
  ) {
    throw new Error('Signal cache result acknowledgement is invalid.');
  }
  return {
    type: 'translation.cacheResultApplied',
    requestId: assertSignalProtocolUuid(record.requestId),
    appliedCount: Number(record.appliedCount)
  };
}

function normalizeSignalCacheSourceText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function legacySignalSourceHash(value: string) {
  let hash = 2166136261;
  for (const char of normalizeSignalCacheSourceText(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isValidSignalTranslationProjection(message: SignalVisibleMessage) {
  const sourceText = normalizeSignalCacheSourceText(message.sourceText);
  return Boolean(
    sourceText === message.sourceText &&
      sourceText.length > 0 &&
      sourceText.length <= 4_000 &&
      /[A-Za-z]/.test(sourceText) &&
      !/[\u3400-\u9fff]/u.test(sourceText) &&
      legacySignalSourceHash(sourceText) === message.sourceHash
  );
}

function hasSignalCacheTranslationPromptLeak(value: string) {
  return /translate the following chat message|return only the translated message|keep\s+emojis?,?\s*urls|请将以下英文聊天信息翻译成中文|(?:保留|保持)\s*表情符号|你是一名(?:中译英|英译中)聊天翻译助手|只输出(?:英文|中文)译文|普通英文单词和短语必须翻译|保持原有换行和空行结构|敏感信息占位符必须原样保留|仅返回翻译后的信息|无需解释/i.test(value);
}

function isUsefulSignalCacheTranslation(sourceText: string, translatedText: string) {
  const source = normalizeSignalCacheSourceText(sourceText);
  const translated = normalizeSignalCacheSourceText(translatedText);
  if (!translated) return false;
  if (hasSignalCacheTranslationPromptLeak(translated)) return false;
  if (source && translated.toLowerCase() === source.toLowerCase()) return false;
  if ((!source || /[A-Za-z]{2,}/.test(source)) && !/[\u4e00-\u9fff]/.test(translated)) {
    return false;
  }
  return true;
}
// SIGNAL_CACHE_PROTOCOL_PURE_END

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
    join(app.getPath('appData'), 'maoyi maoyi')
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

function signalSourceOnlyAcceptanceSummaryPath() {
  return join(app.getPath('userData'), 'signal-source-only-acceptance-summary.json');
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

let signalExecutableCandidatesCache: string[] | null = null;

function signalExecutableCandidates() {
  if (signalExecutableCandidatesCache) return signalExecutableCandidatesCache;
  const developmentExecutable = join(developmentProjectRoot, '.runtime', 'signal-desktop', 'Signal.exe');
  const packagedExecutable = join(process.resourcesPath || '', 'signal', 'Signal.exe');
  if (app.isPackaged) {
    signalExecutableCandidatesCache = [packagedExecutable];
    return signalExecutableCandidatesCache;
  }
  if (!signalSourceExperimentValue) {
    signalExecutableCandidatesCache = [developmentExecutable];
    return signalExecutableCandidatesCache;
  }
  if (!isAbsolute(signalSourceExperimentValue)) {
    throw new Error('MAOYI_SIGNAL_SOURCE_EXE must be an absolute path.');
  }

  const experimentRoot = canonicalRealDirectory(
    join(developmentProjectRoot, '.tmp', 'signal-source'),
    'Signal source experiment root'
  );
  const isolatedRuntimeRoot = canonicalRealDirectory(
    join(developmentProjectRoot, '.tmp', 'signal-source-ui'),
    'Signal source isolated runtime root'
  );
  const requestedExecutable = resolve(signalSourceExperimentValue);
  const experimentExecutable = realpathSync.native(requestedExecutable);
  if (
    lstatSync(requestedExecutable).isSymbolicLink() ||
    !statSync(experimentExecutable).isFile() ||
    basename(experimentExecutable).toLowerCase() !== 'signal.exe'
  ) {
    throw new Error('Signal source experiment executable must be a real Signal.exe file.');
  }
  const isPreparedBuild = isCanonicalChildPath(experimentRoot, experimentExecutable);
  const isIsolatedRuntimeCopy = isCanonicalChildPath(isolatedRuntimeRoot, experimentExecutable);
  if (!isPreparedBuild && !isIsolatedRuntimeCopy) {
    throw new Error('Signal source experiment executable escaped its prepared or isolated root.');
  }
  const executableRoot = isPreparedBuild ? experimentRoot : isolatedRuntimeRoot;

  const unpackedRoot = dirname(experimentExecutable);
  const releaseRoot = dirname(unpackedRoot);
  if (basename(unpackedRoot).toLowerCase() !== 'win-unpacked' || basename(releaseRoot).toLowerCase() !== 'release') {
    throw new Error('Signal source experiment executable must come from release/win-unpacked.');
  }
  const resourcesPath = realpathSync.native(join(unpackedRoot, 'resources'));
  if (lstatSync(join(unpackedRoot, 'resources')).isSymbolicLink() || !statSync(resourcesPath).isDirectory()) {
    throw new Error('Signal source experiment resources directory is missing.');
  }
  assertCanonicalChildPath(executableRoot, resourcesPath, 'Signal source experiment resources');

  const preparedRoot = isPreparedBuild ? dirname(dirname(releaseRoot)) : dirname(releaseRoot);
  const markerFileName = isPreparedBuild
    ? '.df-source-experiment.json'
    : '.df-signal-source-runtime-copy.json';
  const marker = JSON.parse(readFileSync(join(preparedRoot, markerFileName), 'utf8')) as {
    schemaVersion?: unknown;
    version?: unknown;
    patchSetSha256?: unknown;
    executableRelativePath?: unknown;
    sourceExecutableSha256?: unknown;
  };
  const expectedPatchSetSha256 = typeof marker.version === 'string'
    ? supportedSignalSourcePatchSets[marker.version]
    : undefined;
  if (
    marker.schemaVersion !== 1 ||
    typeof marker.version !== 'string' ||
    typeof marker.patchSetSha256 !== 'string' ||
    !expectedPatchSetSha256 ||
    marker.patchSetSha256.toUpperCase() !== expectedPatchSetSha256 ||
    (isPreparedBuild && (
      basename(preparedRoot) !== `v${marker.version}` ||
      basename(dirname(releaseRoot)) !== `Signal-Desktop-${marker.version}`
    )) ||
    (isIsolatedRuntimeCopy && (
      marker.executableRelativePath !== 'release/win-unpacked/Signal.exe' ||
      resolve(preparedRoot, marker.executableRelativePath) !== experimentExecutable
    ))
  ) {
    throw new Error('Signal source experiment marker does not match the release layout.');
  }

  const expectedSha256 = process.env.MAOYI_SIGNAL_SOURCE_SHA256?.trim();
  if (!expectedSha256 || !/^[0-9A-F]{64}$/i.test(expectedSha256)) {
    throw new Error('Signal source experiments require MAOYI_SIGNAL_SOURCE_SHA256.');
  }
  if (
    isIsolatedRuntimeCopy &&
    (typeof marker.sourceExecutableSha256 !== 'string' ||
      marker.sourceExecutableSha256.toUpperCase() !== expectedSha256.toUpperCase())
  ) {
    throw new Error('Signal source isolated runtime marker does not match the requested SHA-256.');
  }

  signalSourceExperimentMetadata = {
    version: marker.version,
    patchSetSha256: marker.patchSetSha256.toUpperCase(),
    isolatedRuntimeCopy: isIsolatedRuntimeCopy
  };
  signalExecutableCandidatesCache = [experimentExecutable];
  return signalExecutableCandidatesCache;
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

type LockCredentialFormat = 'legacy-6-digit' | 'digits6-letters2';

type ProtectedLockCredential = {
  schemaVersion: 1;
  format: LockCredentialFormat;
  salt: string;
  pinHash: string;
};

type LockScreenStateBase = {
  version: number;
  enabled: boolean;
  failedAttempts: number;
  lockedUntil: number;
  createdAt: number;
  updatedAt: number;
};

type LegacyLockScreenState = LockScreenStateBase & {
  version: 1;
  salt: string;
  pinHash: string;
};

type ProtectedLockScreenState = LockScreenStateBase & {
  version: 2;
  credentialFormat: LockCredentialFormat;
  protectedCredential: string;
};

type UnreadableLockScreenState = LockScreenStateBase & {
  version: 0;
  credentialError: string;
};

type LockScreenState = LegacyLockScreenState | ProtectedLockScreenState | UnreadableLockScreenState;

type LockPinChangeAuthorization = {
  senderId: number;
  mode: LockScreenPinChangeMode;
  stateVersion: number;
  stateUpdatedAt: number;
  expiresAt: number;
};

const lockScreenMaxAttempts = 3;
const networkOfflineSampleDelayMs = 250;
const localRouteCheckTimeoutMs = 2_000;
const lockPinChangeAuthorizationTtlMs = 15 * 60 * 1000;
const legacyUpgradeAuthorizationTtlMs = 15 * 60 * 1000;
const lockPinChangeAuthorizations = new Map<string, LockPinChangeAuthorization>();
let legacyUpgradeAuthorizedUntil = 0;

function defaultLockScreenStatus(): LockScreenStatus {
  return {
    enabled: false,
    lockedUntil: 0,
    failedAttempts: 0,
    maxAttempts: lockScreenMaxAttempts,
    requiresUpgrade: false
  };
}

function lockScreenStateRequiresUpgrade(state: LockScreenState | null) {
  return Boolean(
    state?.enabled &&
    (state.version === 1 || (state.version === 2 && state.credentialFormat === 'legacy-6-digit'))
  );
}

function lockScreenStatusFromState(state: LockScreenState | null): LockScreenStatus {
  if (!state?.enabled) return defaultLockScreenStatus();
  return {
    enabled: true,
    lockedUntil: state.lockedUntil || 0,
    failedAttempts: state.failedAttempts || 0,
    maxAttempts: lockScreenMaxAttempts,
    requiresUpgrade: lockScreenStateRequiresUpgrade(state)
  };
}

function unreadableLockScreenState(reason: string): UnreadableLockScreenState {
  return {
    version: 0,
    enabled: true,
    failedAttempts: lockScreenMaxAttempts,
    lockedUntil: 0,
    createdAt: 0,
    updatedAt: 0,
    credentialError: reason
  };
}

function lockStateNumbers(value: Record<string, unknown>) {
  return {
    failedAttempts: Number.isInteger(value.failedAttempts) ? Math.max(0, Number(value.failedAttempts)) : 0,
    lockedUntil: Number.isFinite(value.lockedUntil) ? Math.max(0, Number(value.lockedUntil)) : 0,
    createdAt: Number.isFinite(value.createdAt) ? Math.max(0, Number(value.createdAt)) : Date.now(),
    updatedAt: Number.isFinite(value.updatedAt) ? Math.max(0, Number(value.updatedAt)) : Date.now()
  };
}

function assertSafeStorageAvailable(action: string) {
  if (process.platform !== 'win32' || !safeStorage.isEncryptionAvailable()) {
    throw new Error(`Windows 安全存储不可用，无法${action}锁屏凭据`);
  }
}

function protectLockCredential(credential: ProtectedLockCredential) {
  assertSafeStorageAvailable('安全保存');
  return safeStorage.encryptString(JSON.stringify(credential)).toString('base64');
}

function unprotectLockCredential(state: ProtectedLockScreenState): ProtectedLockCredential {
  assertSafeStorageAvailable('读取');
  try {
    const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(state.protectedCredential, 'base64'))) as ProtectedLockCredential;
    if (
      parsed?.schemaVersion !== 1 ||
      (parsed.format !== 'legacy-6-digit' && parsed.format !== 'digits6-letters2') ||
      parsed.format !== state.credentialFormat ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.pinHash !== 'string'
    ) {
      throw new Error('invalid protected credential');
    }
    return parsed;
  } catch {
    throw new Error('锁屏凭据无法由本机 Windows 安全存储解密；锁屏保持启用，请离线重置凭据');
  }
}

async function migrateLegacyLockScreenState(state: LegacyLockScreenState): Promise<ProtectedLockScreenState> {
  const migrated: ProtectedLockScreenState = {
    version: 2,
    enabled: true,
    credentialFormat: 'legacy-6-digit',
    protectedCredential: protectLockCredential({
      schemaVersion: 1,
      format: 'legacy-6-digit',
      salt: state.salt,
      pinHash: state.pinHash
    }),
    failedAttempts: state.failedAttempts,
    lockedUntil: state.lockedUntil,
    createdAt: state.createdAt,
    updatedAt: Date.now()
  };
  await writeLockScreenState(migrated);
  return migrated;
}

async function readLockScreenState(): Promise<LockScreenState | null> {
  let raw = '';
  try {
    raw = await readFile(lockScreenPath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return unreadableLockScreenState('锁屏状态文件无法读取');
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || parsed.enabled !== true) return unreadableLockScreenState('锁屏状态文件格式无效');
    const numbers = lockStateNumbers(parsed);
    if (parsed.version === 2) {
      if (
        (parsed.credentialFormat !== 'legacy-6-digit' && parsed.credentialFormat !== 'digits6-letters2') ||
        typeof parsed.protectedCredential !== 'string' ||
        !parsed.protectedCredential
      ) {
        return unreadableLockScreenState('锁屏凭据密文格式无效');
      }
      const protectedState: ProtectedLockScreenState = {
        version: 2,
        enabled: true,
        credentialFormat: parsed.credentialFormat,
        protectedCredential: parsed.protectedCredential,
        ...numbers
      };
      try {
        unprotectLockCredential(protectedState);
        return protectedState;
      } catch (error) {
        return unreadableLockScreenState(error instanceof Error ? error.message : '锁屏凭据密文无法读取');
      }
    }
    if (
      (parsed.version === 1 || parsed.version === undefined) &&
      typeof parsed.salt === 'string' &&
      typeof parsed.pinHash === 'string' &&
      parsed.salt &&
      parsed.pinHash
    ) {
      const legacy: LegacyLockScreenState = {
        version: 1,
        enabled: true,
        salt: parsed.salt,
        pinHash: parsed.pinHash,
        ...numbers
      };
      if (process.platform === 'win32' && safeStorage.isEncryptionAvailable()) {
        try {
          return await migrateLegacyLockScreenState(legacy);
        } catch {
          return legacy;
        }
      }
      return legacy;
    }
    return unreadableLockScreenState('锁屏状态文件格式无效');
  } catch {
    return unreadableLockScreenState('锁屏状态文件格式无效');
  }
}

async function writeLockScreenState(state: LockScreenState) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeJsonAtomic(lockScreenPath(), state);
}

function normalizeNewLockCredential(value: string) {
  const credential = value.toUpperCase();
  if (!/^\d{6}[A-Z]{2}$/.test(credential)) {
    throw new Error('锁屏凭据必须为前 6 位数字加后 2 位英文字母');
  }
  return credential;
}

function normalizeCredentialForFormat(value: string, format: LockCredentialFormat) {
  if (format === 'legacy-6-digit') {
    if (!/^\d{6}$/.test(value)) throw new Error('旧版锁屏凭据必须为 6 位数字');
    return value;
  }
  return normalizeNewLockCredential(value);
}

function hashLockPin(pin: string, salt: string) {
  return scryptSync(pin, Buffer.from(salt, 'base64'), 64).toString('base64');
}

function readRouteTable(args: string[]) {
  return new Promise<string>((resolvePromise, reject) => {
    execFile(
      'route.exe',
      args,
      { windowsHide: true, timeout: localRouteCheckTimeoutMs, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(stdout);
      }
    );
  });
}

async function sampleNetworkOffline() {
  if (process.platform !== 'win32') return { offline: false, uncertain: true };
  let hasNonLoopbackInterface = false;
  try {
    hasNonLoopbackInterface = Object.values(networkInterfaces()).some((addresses) =>
      (addresses || []).some((address) => !address.internal && Boolean(address.address))
    );
  } catch {
    return { offline: false, uncertain: true };
  }

  try {
    const [ipv4Routes, ipv6Routes] = await Promise.all([
      readRouteTable(['PRINT', '0.0.0.0']),
      readRouteTable(['PRINT', '-6', '::/0'])
    ]);
    const hasIpv4DefaultRoute = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+/m.test(ipv4Routes);
    const hasIpv6DefaultRoute = /^\s*(?:\d+\s+\d+\s+)?::\/0\s+/m.test(ipv6Routes);
    return {
      offline: !hasNonLoopbackInterface && !hasIpv4DefaultRoute && !hasIpv6DefaultRoute,
      uncertain: false
    };
  } catch {
    return { offline: false, uncertain: true };
  }
}

async function inspectNetworkOfflineTwice(): Promise<NetworkOfflineCheckResult> {
  const first = await sampleNetworkOffline();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, networkOfflineSampleDelayMs));
  const second = await sampleNetworkOffline();
  const checkedAt = Date.now();
  if (first.uncertain || second.uncertain) {
    return { offline: false, checkedAt, reason: '无法确认本机已断网，已拒绝设置或重置锁屏凭据' };
  }
  if (!first.offline || !second.offline) {
    return { offline: false, checkedAt, reason: '检测到本机仍有活动网络连接，请断开网络后重试' };
  }
  return { offline: true, checkedAt };
}

async function checkNetworkOffline(): Promise<NetworkOfflineCheckResult> {
  return inspectNetworkOfflineTwice();
}

function lockPinChangeModeAllowed(
  state: LockScreenState | null,
  mode: LockScreenPinChangeMode,
  now = Date.now()
) {
  if (mode === 'setup') return !state?.enabled;
  if (mode === 'reset') return Boolean(state?.enabled && state.failedAttempts >= lockScreenMaxAttempts);
  return Boolean(state?.enabled && lockScreenStateRequiresUpgrade(state) && legacyUpgradeAuthorizedUntil >= now);
}

function lockPinChangeModeError(state: LockScreenState | null, mode: LockScreenPinChangeMode) {
  if (mode === 'setup') return state?.enabled ? '锁屏凭据已存在，不能重复执行首次设置' : '当前状态不能首次设置锁屏凭据';
  if (mode === 'reset') return '当前尚未达到锁屏凭据重置条件';
  if (!lockScreenStateRequiresUpgrade(state)) return '当前锁屏凭据不需要升级';
  return '请先使用旧 6 位凭据成功解锁，再升级锁屏凭据';
}

async function authorizeLockScreenPinChange(
  senderId: number,
  mode: LockScreenPinChangeMode
): Promise<LockScreenPinChangeAuthorizationResult> {
  const state = await readLockScreenState();
  if (!lockPinChangeModeAllowed(state, mode)) {
    return { ok: false, reason: lockPinChangeModeError(state, mode), status: lockScreenStatusFromState(state) };
  }
  const networkResult = await inspectNetworkOfflineTwice();
  if (!networkResult.offline) {
    return { ok: false, reason: networkResult.reason, status: lockScreenStatusFromState(state) };
  }
  const now = Date.now();
  for (const [existingToken, authorization] of lockPinChangeAuthorizations) {
    if (authorization.expiresAt <= now || authorization.senderId === senderId) {
      lockPinChangeAuthorizations.delete(existingToken);
    }
  }
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + lockPinChangeAuthorizationTtlMs;
  lockPinChangeAuthorizations.set(token, {
    senderId,
    mode,
    stateVersion: state?.version ?? -1,
    stateUpdatedAt: state?.updatedAt ?? 0,
    expiresAt
  });
  return { ok: true, token, expiresAt, status: lockScreenStatusFromState(state) };
}

function consumeLockPinChangeAuthorization(senderId: number, token: string) {
  const authorization = lockPinChangeAuthorizations.get(token);
  lockPinChangeAuthorizations.delete(token);
  if (!authorization || authorization.senderId !== senderId || authorization.expiresAt <= Date.now()) {
    throw new Error('锁屏凭据设置授权无效或已过期，请重新断网检查');
  }
  return authorization;
}

async function getLockScreenStatus(): Promise<LockScreenStatus> {
  return lockScreenStatusFromState(await readLockScreenState());
}

async function setLockScreenPin(senderId: number, pin: string, token: string): Promise<LockScreenSetPinResult> {
  try {
    const credential = normalizeNewLockCredential(pin);
    const authorization = consumeLockPinChangeAuthorization(senderId, token);
    const currentState = await readLockScreenState();
    if (
      authorization.stateVersion !== (currentState?.version ?? -1) ||
      authorization.stateUpdatedAt !== (currentState?.updatedAt ?? 0) ||
      !lockPinChangeModeAllowed(currentState, authorization.mode)
    ) {
      throw new Error('锁屏状态已变化，请重新断网检查并申请设置授权');
    }
    const networkResult = await inspectNetworkOfflineTwice();
    if (!networkResult.offline) {
      throw new Error(networkResult.reason || '无法确认本机已断网，已拒绝设置或重置锁屏凭据');
    }
    const now = Date.now();
    const salt = randomBytes(16).toString('base64');
    const state: ProtectedLockScreenState = {
      version: 2,
      enabled: true,
      credentialFormat: 'digits6-letters2',
      protectedCredential: protectLockCredential({
        schemaVersion: 1,
        format: 'digits6-letters2',
        salt,
        pinHash: hashLockPin(credential, salt)
      }),
      failedAttempts: 0,
      lockedUntil: 0,
      createdAt: currentState?.createdAt || now,
      updatedAt: now
    };
    await writeLockScreenState(state);
    legacyUpgradeAuthorizedUntil = 0;
    if (remoteGuardIncidentLatched && !remoteGuardThreatActive) clearRemoteGuardIncident();
    releaseWorkspaceVisibilityLock();
    return { ok: true, status: lockScreenStatusFromState(state) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '设置或重置锁屏凭据失败', status: await getLockScreenStatus() };
  }
}

async function unlockLockScreen(pin: string): Promise<LockScreenUnlockResult> {
  let state = await readLockScreenState();
  if (!state?.enabled) return { ok: false, reason: '请先设置锁屏凭据', status: defaultLockScreenStatus() };
  if (remoteGuardThreatActive) {
    return { ok: false, reason: '御前侍卫仍检测到远控，工作区保持锁定', status: lockScreenStatusFromState(state) };
  }
  if (state.version === 0) {
    return { ok: false, reason: `${state.credentialError}；请断网重置锁屏凭据`, status: lockScreenStatusFromState(state) };
  }
  if (state.version === 1) {
    try {
      state = await migrateLegacyLockScreenState(state);
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : '旧版锁屏凭据无法安全迁移；锁屏保持启用',
        status: lockScreenStatusFromState(state)
      };
    }
  }

  let protectedCredential: ProtectedLockCredential;
  try {
    protectedCredential = unprotectLockCredential(state);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : '锁屏凭据无法读取；锁屏保持启用',
      status: lockScreenStatusFromState(state)
    };
  }

  const now = Date.now();
  let normalized = '';
  try {
    normalized = normalizeCredentialForFormat(pin, protectedCredential.format);
  } catch {
    normalized = '';
  }
  const expected = Buffer.from(protectedCredential.pinHash, 'base64');
  const actual = normalized
    ? Buffer.from(hashLockPin(normalized, protectedCredential.salt), 'base64')
    : Buffer.alloc(0);
  const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
  if (ok) {
    state.failedAttempts = 0;
    state.lockedUntil = 0;
    state.updatedAt = now;
    await writeLockScreenState(state);
    if (protectedCredential.format === 'legacy-6-digit') {
      legacyUpgradeAuthorizedUntil = now + legacyUpgradeAuthorizationTtlMs;
    } else {
      if (remoteGuardIncidentLatched) clearRemoteGuardIncident();
      releaseWorkspaceVisibilityLock();
    }
    return { ok: true, status: lockScreenStatusFromState(state) };
  }

  state.failedAttempts = (state.failedAttempts || 0) + 1;
  let reason = `锁屏凭据错误，还可尝试 ${Math.max(0, lockScreenMaxAttempts - state.failedAttempts)} 次`;
  if (state.failedAttempts >= lockScreenMaxAttempts) {
    state.failedAttempts = lockScreenMaxAttempts;
    state.lockedUntil = 0;
    reason = '锁屏凭据错误次数已达上限，请断网后重置';
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
    profileTabOrder: [],
    lastActiveProfileIds: {
      whatsapp: null,
      telegram: null,
      signal: null
    },
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

let translationPromptsCache: TranslationPrompts | null = null;
let smartReplyPromptCache: SmartReplyPrompt | null = null;

function packagedTranslationPromptPath() {
  return join(process.resourcesPath, translationPromptBundleFileName);
}

function activeTranslationPromptPath() {
  return join(app.getPath('userData'), 'security', translationPromptBundleFileName);
}

function pendingTranslationPromptPath() {
  return `${activeTranslationPromptPath()}.pending`;
}

function translationPromptStatePath() {
  return join(app.getPath('userData'), 'security', 'translation-prompts-state.json');
}

async function readOptionalText(path: string) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return '';
    throw error;
  }
}

async function writeTextAtomic(path: string, value: string) {
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, value, 'utf8');
  try {
    await rename(tempPath, path);
  } catch {
    await rm(path, { force: true });
    await rename(tempPath, path);
  }
}

async function recordPackagedTranslationPromptHash(hash: string) {
  await mkdir(dirname(translationPromptStatePath()), { recursive: true });
  await writeJsonAtomic(translationPromptStatePath(), { schemaVersion: 1, packagedHash: hash });
}

async function readRecordedPackagedTranslationPromptHash() {
  try {
    const parsed = JSON.parse(await readFile(translationPromptStatePath(), 'utf8')) as Record<string, unknown>;
    return parsed.schemaVersion === 1 && typeof parsed.packagedHash === 'string' ? parsed.packagedHash : '';
  } catch {
    return '';
  }
}

async function loadTranslationPrompts(serviceSecret: string) {
  if (translationPromptsCache) return translationPromptsCache;
  if (!app.isPackaged) {
    const raw = await readOptionalText(join(developmentProjectRoot, '.package-secrets', translationPromptBundleFileName));
    if (!raw) throw new Error(`缺少加密提示词文件：${translationPromptBundleFileName}`);
    translationPromptsCache = decryptTranslationPromptBundle(serviceSecret, raw);
    return translationPromptsCache;
  }

  const packagedRaw = await readOptionalText(packagedTranslationPromptPath());
  const packagedHash = packagedRaw ? createHash('sha256').update(packagedRaw).digest('hex') : '';
  const recordedHash = await readRecordedPackagedTranslationPromptHash();
  if (packagedRaw && packagedHash !== recordedHash) {
    try {
      const imported = decryptTranslationPromptBundle(serviceSecret, packagedRaw);
      await writeTextAtomic(activeTranslationPromptPath(), packagedRaw);
      await recordPackagedTranslationPromptHash(packagedHash);
      translationPromptsCache = imported;
      return imported;
    } catch {
      // A packaged file encrypted with the previous authorization must not block a valid active copy.
    }
  }

  const pendingRaw = await readOptionalText(pendingTranslationPromptPath());
  if (pendingRaw) {
    try {
      const recovered = decryptTranslationPromptBundle(serviceSecret, pendingRaw);
      await writeTextAtomic(activeTranslationPromptPath(), pendingRaw);
      await rm(pendingTranslationPromptPath(), { force: true });
      translationPromptsCache = recovered;
      return recovered;
    } catch {
      // A pending file for an uncommitted authorization is ignored.
    }
  }

  const activeRaw = await readOptionalText(activeTranslationPromptPath());
  if (activeRaw) {
    translationPromptsCache = decryptTranslationPromptBundle(serviceSecret, activeRaw);
    return translationPromptsCache;
  }
  if (!packagedRaw) throw new Error(`缺少加密提示词文件：${translationPromptBundleFileName}`);
  translationPromptsCache = decryptTranslationPromptBundle(serviceSecret, packagedRaw);
  await writeTextAtomic(activeTranslationPromptPath(), packagedRaw);
  await recordPackagedTranslationPromptHash(packagedHash);
  return translationPromptsCache;
}

function packagedSmartReplyPromptPath() {
  return join(process.resourcesPath, smartReplyPromptBundleFileName);
}

function activeSmartReplyPromptPath() {
  return join(app.getPath('userData'), 'security', smartReplyPromptBundleFileName);
}

function pendingSmartReplyPromptPath() {
  return `${activeSmartReplyPromptPath()}.pending`;
}

function smartReplyPromptStatePath() {
  return join(app.getPath('userData'), 'security', 'smart-reply-prompt-state.json');
}

async function recordPackagedSmartReplyPromptHash(hash: string) {
  await mkdir(dirname(smartReplyPromptStatePath()), { recursive: true });
  await writeJsonAtomic(smartReplyPromptStatePath(), { schemaVersion: 1, packagedHash: hash });
}

async function readRecordedPackagedSmartReplyPromptHash() {
  try {
    const parsed = JSON.parse(await readFile(smartReplyPromptStatePath(), 'utf8')) as Record<string, unknown>;
    return parsed.schemaVersion === 1 && typeof parsed.packagedHash === 'string' ? parsed.packagedHash : '';
  } catch {
    return '';
  }
}

async function smartReplyPromptBundleExists() {
  const candidates = app.isPackaged
    ? [packagedSmartReplyPromptPath(), pendingSmartReplyPromptPath(), activeSmartReplyPromptPath()]
    : [join(developmentProjectRoot, '.package-secrets', smartReplyPromptBundleFileName)];
  for (const path of candidates) {
    if (await readOptionalText(path)) return true;
  }
  return false;
}

async function loadSmartReplyPrompt(serviceSecret: string) {
  if (smartReplyPromptCache) return smartReplyPromptCache;
  if (!app.isPackaged) {
    const raw = await readOptionalText(join(developmentProjectRoot, '.package-secrets', smartReplyPromptBundleFileName));
    if (!raw) throw new Error(`Missing encrypted smart reply prompt file: ${smartReplyPromptBundleFileName}`);
    smartReplyPromptCache = decryptSmartReplyPromptBundle(serviceSecret, raw);
    return smartReplyPromptCache;
  }

  const packagedRaw = await readOptionalText(packagedSmartReplyPromptPath());
  const packagedHash = packagedRaw ? createHash('sha256').update(packagedRaw).digest('hex') : '';
  const recordedHash = await readRecordedPackagedSmartReplyPromptHash();
  if (packagedRaw && packagedHash !== recordedHash) {
    try {
      const imported = decryptSmartReplyPromptBundle(serviceSecret, packagedRaw);
      await writeTextAtomic(activeSmartReplyPromptPath(), packagedRaw);
      await recordPackagedSmartReplyPromptHash(packagedHash);
      smartReplyPromptCache = imported;
      return imported;
    } catch {
      // A newly installed bundle may belong to the previous authorization. A
      // valid active copy remains authoritative in that case.
    }
  }

  const pendingRaw = await readOptionalText(pendingSmartReplyPromptPath());
  if (pendingRaw) {
    try {
      const recovered = decryptSmartReplyPromptBundle(serviceSecret, pendingRaw);
      await writeTextAtomic(activeSmartReplyPromptPath(), pendingRaw);
      await rm(pendingSmartReplyPromptPath(), { force: true });
      smartReplyPromptCache = recovered;
      return recovered;
    } catch {
      // Ignore data staged for an authorization that never committed.
    }
  }

  const activeRaw = await readOptionalText(activeSmartReplyPromptPath());
  if (activeRaw) {
    smartReplyPromptCache = decryptSmartReplyPromptBundle(serviceSecret, activeRaw);
    return smartReplyPromptCache;
  }
  if (!packagedRaw) throw new Error(`Missing encrypted smart reply prompt file: ${smartReplyPromptBundleFileName}`);
  smartReplyPromptCache = decryptSmartReplyPromptBundle(serviceSecret, packagedRaw);
  await writeTextAtomic(activeSmartReplyPromptPath(), packagedRaw);
  await recordPackagedSmartReplyPromptHash(packagedHash);
  return smartReplyPromptCache;
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
        userAgent: resolveProfileUserAgent(
          profile.platform,
          profile.fingerprint?.userAgent,
          userAgentForPlatform(profile.platform)
        )
      }
    };
  });
  const activeProfileId = profiles.some((profile) => profile.id === config.activeProfileId)
    ? config.activeProfileId
    : profiles[0]?.id ?? null;
  const profileTabOrder = sanitizeProfileTabOrder(profiles, config.profileTabOrder);
  const lastActiveProfileIds = sanitizeLastActiveProfileIds(
    profiles,
    config.lastActiveProfileIds,
    activeProfileId,
    profileTabOrder
  );

  return {
    profiles,
    activeProfileId,
    profileTabOrder,
    lastActiveProfileIds,
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
  config.profileTabOrder = [...config.profileTabOrder.filter((profileId) => profileId !== profile.id), profile.id];
  config.lastActiveProfileIds[workspaceAppForPlatform(profile.platform)] = profile.id;
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

async function hashFileSha256(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex').toUpperCase();
}

async function resolveSignalExecutable() {
  for (const candidate of signalExecutableCandidates()) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      if (signalSourceExperimentValue) {
        const expectedSha256 = process.env.MAOYI_SIGNAL_SOURCE_SHA256?.trim().toUpperCase();
        const actualSha256 = await hashFileSha256(candidate);
        if (!expectedSha256 || actualSha256 !== expectedSha256) {
          throw new Error('Signal source experiment executable SHA-256 changed before launch.');
        }
      }
      return candidate;
    } catch (error) {
      if (signalSourceExperimentValue) throw error;
      // Keep checking the explicitly allowed candidates.
    }
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
          clearSignalCacheRequestState(appId);
          signalControlClients.set(appId, {
            ...controlSession,
            socket,
            connectedAt: Date.now(),
            lastSeenAt: Date.now(),
            sendSequence: 0,
            receiveSequence: 0
          });
          void persistSignalControlStatus();
          sendSignalOwner(appId);
          sendSignalVisibilityState(appId);
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
      clearSignalCacheRequestState(appId);
      settleSignalVisibilityApplied(appId, workspaceVisibilityGate.revision, false);
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
  const businessPayload = stripSignalControlTransportMetadata(envelope.payload, appId);
  if (!businessPayload) return null;
  client.receiveSequence = expectedSequence;
  client.lastSeenAt = Date.now();
  return businessPayload;
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

function getSignalOwnerDescriptor() {
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return null;
  try {
    const handle = mainWindow.getNativeWindowHandle();
    if (handle.length !== 8) return null;
    return {
      type: 'window.owner',
      handle: handle.toString('base64url'),
      ownerProcessId: process.pid
    };
  } catch {
    return null;
  }
}

function sendSignalOwner(appId: string) {
  const owner = getSignalOwnerDescriptor();
  return owner ? sendSignalControlMessage(appId, owner) : false;
}

function sendSignalVisibilityState(appId: string) {
  return sendSignalControlMessage(appId, {
    type: 'security.visibility',
    locked: workspaceVisibilityGate.locked,
    revision: workspaceVisibilityGate.revision
  });
}

function advanceWorkspaceVisibilityGate(locked: boolean) {
  workspaceVisibilityGate = {
    locked,
    revision: workspaceVisibilityGate.revision + 1
  };
  if (locked) {
    visibleSignalProfileId = null;
    clearAllSignalCacheRequestState();
    hideAllSignalWindows();
    for (const [requestId, request] of signalScriptRequests) {
      clearTimeout(request.timer);
      request.reject(new Error('Workspace locked before Signal script completion.'));
      signalScriptRequests.delete(requestId);
    }
  }
  return workspaceVisibilityGate.revision;
}

function broadcastSignalVisibilityState() {
  for (const appId of signalControlClients.keys()) {
    sendSignalVisibilityState(appId);
  }
}

function waitForSignalVisibilityApplied(appId: string, revision: number) {
  const existing = signalVisibilityAckWaiters.get(appId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const current = signalVisibilityAckWaiters.get(appId);
      if (current?.revision === revision) signalVisibilityAckWaiters.delete(appId);
      resolve(false);
    }, signalVisibilityAckTimeoutMs);
    signalVisibilityAckWaiters.set(appId, { revision, resolve, timer });
  });
}

function settleSignalVisibilityApplied(appId: string, revision: number, applied: boolean) {
  const waiter = signalVisibilityAckWaiters.get(appId);
  if (!waiter || waiter.revision !== revision) return;
  signalVisibilityAckWaiters.delete(appId);
  clearTimeout(waiter.timer);
  waiter.resolve(applied);
}

function isSignalProcessIdAlive(processId: number) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function waitForSignalProcessExit(child: ChildProcess | undefined, processId: number, timeoutMs: number) {
  if (child && child.exitCode !== null) return Promise.resolve(true);
  if (!isSignalProcessIdAlive(processId)) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child?.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const deadline = Date.now() + timeoutMs;
    const checkExit = () => {
      if ((child && child.exitCode !== null) || !isSignalProcessIdAlive(processId)) {
        finish(true);
        return;
      }
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      timer = setTimeout(checkExit, 25);
    };
    child?.once('exit', onExit);
    checkExit();
  });
}

async function forceTerminateSignalProcess(
  processId: number,
  child: ChildProcess | undefined
) {
  if (!isSignalProcessIdAlive(processId)) return true;
  try {
    process.kill(processId, 'SIGKILL');
  } catch {
    if (isSignalProcessIdAlive(processId)) return false;
  }
  return waitForSignalProcessExit(child, processId, signalVisibilityShutdownGraceMs);
}

async function terminateSignalInstanceFailClosed(appId: string) {
  const profileId = profileIdFromSignalAppId(appId);
  const child = signalProcesses.get(profileId);
  const client = signalControlClients.get(appId);
  const authenticatedProcessId = client?.processId;
  const trackedProcessId = child?.pid;
  const failedProcessIds = new Set<number>();

  try {
    sendSignalControlMessage(appId, { type: 'shutdown' });
    if (authenticatedProcessId) {
      const authenticatedChild = child?.pid === authenticatedProcessId ? child : undefined;
      const exitedGracefully = await waitForSignalProcessExit(
        authenticatedChild,
        authenticatedProcessId,
        signalVisibilityShutdownGraceMs
      );
      if (
        !exitedGracefully &&
        !(await forceTerminateSignalProcess(authenticatedProcessId, authenticatedChild))
      ) {
        failedProcessIds.add(authenticatedProcessId);
      }
    }

    if (
      trackedProcessId &&
      trackedProcessId !== authenticatedProcessId &&
      child?.exitCode === null &&
      !(await forceTerminateSignalProcess(trackedProcessId, child))
    ) {
      failedProcessIds.add(trackedProcessId);
    }
  } finally {
    client?.socket.destroy();
    signalControlClients.delete(appId);
    signalControlSessions.delete(appId);
  }

  if (failedProcessIds.size > 0) {
    throw new Error(
      `Workspace remains locked because Signal termination could not be confirmed for ${appId} ` +
        `(PID ${Array.from(failedProcessIds).join(', ')}).`
    );
  }
}

async function engageWorkspaceVisibilityLock() {
  const revision = advanceWorkspaceVisibilityGate(true);
  const liveAppIds = new Set<string>();
  for (const [profileId, child] of signalProcesses) {
    if (child.exitCode === null) liveAppIds.add(signalAppId(profileId));
  }
  for (const appId of signalControlClients.keys()) liveAppIds.add(appId);

  const acknowledgements = new Map<string, Promise<boolean>>();
  for (const appId of liveAppIds) {
    if (signalControlClients.has(appId)) {
      acknowledgements.set(appId, waitForSignalVisibilityApplied(appId, revision));
    }
  }
  broadcastSignalVisibilityState();
  hideAllSignalWindows();

  const failed = new Set<string>();
  const captureTerminationFailure = async (appId: string) => {
    try {
      await terminateSignalInstanceFailClosed(appId);
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  };
  const immediateTerminations = Array.from(liveAppIds)
    .filter((appId) => !acknowledgements.has(appId))
    .map((appId) => captureTerminationFailure(appId));
  for (const appId of liveAppIds) {
    const acknowledgement = acknowledgements.get(appId);
    if (acknowledgement && !(await acknowledgement)) failed.add(appId);
  }
  const terminationFailures = (await Promise.all([
    ...immediateTerminations,
    ...Array.from(failed, (appId) => captureTerminationFailure(appId))
  ])).filter((error): error is Error => Boolean(error));
  hideAllSignalWindows();
  if (terminationFailures.length > 0) {
    throw new Error(terminationFailures.map((error) => error.message).join(' '));
  }
}

function releaseWorkspaceVisibilityLock() {
  if (remoteGuardIncidentLatched) {
    if (!workspaceVisibilityGate.locked) advanceWorkspaceVisibilityGate(true);
    broadcastSignalVisibilityState();
    hideAllSignalWindows();
    return false;
  }
  advanceWorkspaceVisibilityGate(false);
  broadcastSignalVisibilityState();
  return true;
}

function notifyRemoteGuardStatus() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('remote-guard:status-changed', remoteGuardStatus);
}

function remoteGuardAlarmDocument() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>御前侍卫安全警报</title>
  <style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#160408;color:#fff;font-family:"Microsoft YaHei UI","Segoe UI",sans-serif}
    body{display:grid;place-items:center;background:radial-gradient(circle at 50% 42%,rgba(255,67,83,.28),transparent 34%),linear-gradient(145deg,#26040a,#090104 72%)}
    main{width:min(820px,88vw);border:2px solid rgba(255,99,109,.88);border-radius:28px;padding:54px 58px;text-align:center;background:rgba(44,4,11,.92);box-shadow:0 0 0 10px rgba(255,61,76,.08),0 32px 100px rgba(0,0,0,.72);animation:pulse 1s ease-in-out infinite alternate}
    .crest{display:grid;width:108px;height:108px;margin:0 auto 26px;place-items:center;border:4px solid #ff6570;border-radius:50%;color:#fff2d0;font-size:50px;font-weight:900;box-shadow:0 0 44px rgba(255,68,82,.55)}
    h1{margin:0;color:#ff737c;font-size:52px;letter-spacing:8px}h2{margin:18px 0 0;color:#fff;font-size:30px}p{margin:25px 0 0;color:rgba(255,255,255,.8);font-size:20px;line-height:1.8}
    strong{color:#ffd9a0}@keyframes pulse{from{transform:scale(.994);box-shadow:0 0 0 8px rgba(255,61,76,.07),0 32px 100px rgba(0,0,0,.72)}to{transform:scale(1);box-shadow:0 0 0 16px rgba(255,61,76,.14),0 32px 120px rgba(126,0,18,.62)}}
  </style>
</head>
<body><main><div class="crest">侍</div><h1>安全警报</h1><h2>御前侍卫发现远程连接</h2><p>聊天窗口已经隐藏，系统将在 <strong>3 秒后锁定 Windows</strong><br>请在本机确认远控来源并断开可疑连接</p></main></body>
</html>`;
}

function destroyRemoteGuardAlarmWindows() {
  for (const alarmWindow of remoteGuardAlarmWindows) {
    if (!alarmWindow.isDestroyed()) alarmWindow.destroy();
  }
  remoteGuardAlarmWindows.clear();
}

function showRemoteGuardAlarmWindows() {
  if (!app.isReady() || remoteGuardAlarmWindows.size > 0) return;
  const alarmUrl = `data:text/html;charset=utf-8,${encodeURIComponent(remoteGuardAlarmDocument())}`;
  for (const display of screen.getAllDisplays()) {
    const alarmWindow = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      show: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      backgroundColor: '#160408',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });
    remoteGuardAlarmWindows.add(alarmWindow);
    alarmWindow.on('closed', () => remoteGuardAlarmWindows.delete(alarmWindow));
    alarmWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void alarmWindow.loadURL(alarmUrl).then(() => {
      if (alarmWindow.isDestroyed()) return;
      alarmWindow.setAlwaysOnTop(true, 'screen-saver');
      alarmWindow.showInactive();
      alarmWindow.moveTop();
    }).catch(() => {
      if (!alarmWindow.isDestroyed()) alarmWindow.destroy();
    });
  }
}

function startRemoteGuardAlarmSound() {
  if (remoteGuardBeepTimer) return;
  shell.beep();
  remoteGuardBeepTimer = setInterval(() => shell.beep(), 850);
}

function stopRemoteGuardAlarmSound() {
  if (!remoteGuardBeepTimer) return;
  clearInterval(remoteGuardBeepTimer);
  remoteGuardBeepTimer = null;
}

function focusMainWindowForRemoteGuardRecovery() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();
}

function scheduleRemoteGuardWindowsLock() {
  if (
    remoteGuardWindowsLockTimer ||
    remoteGuardStatus.windowsSessionLocked ||
    !remoteGuardThreatActive ||
    !remoteGuardIncidentLatched
  ) return;
  const windowsLockScheduledAt = Date.now() + remoteGuardWindowsLockDelayMs;
  remoteGuardStatus = {
    ...remoteGuardStatus,
    windowsLockState: 'scheduled',
    windowsLockScheduledAt
  };
  notifyRemoteGuardStatus();
  remoteGuardWindowsLockTimer = setTimeout(() => {
    remoteGuardWindowsLockTimer = null;
    if (!remoteGuardThreatActive || !remoteGuardIncidentLatched || remoteGuardStatus.windowsSessionLocked) return;
    const windowsLockAttemptedAt = Date.now();
    remoteGuardStatus = {
      ...remoteGuardStatus,
      windowsLockState: 'requested',
      windowsLockScheduledAt: undefined,
      windowsLockAttemptedAt
    };
    notifyRemoteGuardStatus();
    void requestWindowsWorkstationLock().then((requested) => {
      if (!requested && !remoteGuardStatus.windowsSessionLocked) {
        remoteGuardRuntimeReason = 'Windows 锁屏请求失败，安全警报保持显示';
        remoteGuardStatus = {
          ...remoteGuardStatus,
          windowsLockState: 'failed',
          reason: remoteGuardRuntimeReason
        };
        notifyRemoteGuardStatus();
      }
    });
  }, remoteGuardWindowsLockDelayMs);
}

function beginRemoteGuardIncident() {
  remoteGuardIncidentLatched = true;
  showRemoteGuardAlarmWindows();
  startRemoteGuardAlarmSound();
  focusMainWindowForRemoteGuardRecovery();
  scheduleRemoteGuardWindowsLock();
  remoteGuardVisibilityLockPromise ??= engageWorkspaceVisibilityLock()
    .catch(() => {
      remoteGuardRuntimeReason = '聊天窗口隐藏确认未完整返回，Windows 锁屏仍将执行';
    })
    .finally(() => {
      remoteGuardVisibilityLockPromise = null;
      if (remoteGuardRuntimeReason) {
        remoteGuardStatus = { ...remoteGuardStatus, reason: remoteGuardRuntimeReason };
        notifyRemoteGuardStatus();
      }
    });
}

function clearRemoteGuardIncident() {
  if (remoteGuardThreatActive) return false;
  const previousRuntimeReason = remoteGuardRuntimeReason;
  remoteGuardIncidentLatched = false;
  remoteGuardRuntimeReason = '';
  if (remoteGuardWindowsLockTimer) {
    clearTimeout(remoteGuardWindowsLockTimer);
    remoteGuardWindowsLockTimer = null;
  }
  destroyRemoteGuardAlarmWindows();
  stopRemoteGuardAlarmSound();
  remoteGuardStatus = {
    ...remoteGuardStatus,
    state: remoteGuardLastClearState,
    threatActive: false,
    incidentLatched: false,
    windowsLockState: remoteGuardStatus.windowsSessionLocked ? 'confirmed' : 'idle',
    windowsLockScheduledAt: undefined,
    reason: remoteGuardStatus.reason === previousRuntimeReason ? undefined : remoteGuardStatus.reason
  };
  notifyRemoteGuardStatus();
  return true;
}

async function runRemoteGuardScan(forceProcessRefresh = false) {
  if (remoteGuardScanPromise) return remoteGuardScanPromise;
  remoteGuardScanPromise = (async () => {
    const startedAt = Date.now();
    const evaluation = await inspectWindowsRemoteAccess(process.pid, { forceProcessRefresh });
    const checkedAt = Date.now();
    remoteGuardThreatActive = evaluation.threatActive;
    remoteGuardLastClearState = evaluation.state;

    if (evaluation.threatActive) {
      if (!remoteGuardIncidentLatched) beginRemoteGuardIncident();
      else {
        showRemoteGuardAlarmWindows();
        startRemoteGuardAlarmSound();
        scheduleRemoteGuardWindowsLock();
      }
    } else {
      if (remoteGuardWindowsLockTimer) {
        clearTimeout(remoteGuardWindowsLockTimer);
        remoteGuardWindowsLockTimer = null;
      }
      if (remoteGuardIncidentLatched) {
        destroyRemoteGuardAlarmWindows();
        focusMainWindowForRemoteGuardRecovery();
      }
    }

    remoteGuardStatus = {
      ...remoteGuardStatus,
      enabled: process.platform === 'win32',
      state: evaluation.threatActive ? 'alarm' : remoteGuardIncidentLatched ? 'recovery' : evaluation.state,
      checkedAt,
      nextScanAt: checkedAt + remoteGuardScanIntervalMs,
      scanDurationMs: Math.max(0, checkedAt - startedAt),
      processScanIntervalMs: remoteGuardProcessScanIntervalMs,
      threatActive: evaluation.threatActive,
      incidentLatched: remoteGuardIncidentLatched,
      windowsLockState: evaluation.threatActive
        ? remoteGuardStatus.windowsLockState
        : remoteGuardStatus.windowsSessionLocked
          ? 'confirmed'
          : 'idle',
      windowsLockScheduledAt: evaluation.threatActive ? remoteGuardStatus.windowsLockScheduledAt : undefined,
      findings: evaluation.findings,
      coverage: evaluation.coverage,
      reason: remoteGuardRuntimeReason || evaluation.reason
    };
    notifyRemoteGuardStatus();
    return remoteGuardStatus;
  })().finally(() => {
    remoteGuardScanPromise = null;
  });
  return remoteGuardScanPromise;
}

async function acknowledgeRemoteGuardIncident(): Promise<RemoteGuardActionResult> {
  if (remoteGuardThreatActive) {
    return { ok: false, reason: '远控迹象仍然存在，工作区保持锁定', status: remoteGuardStatus };
  }
  if (!remoteGuardIncidentLatched) return { ok: true, status: remoteGuardStatus };
  const lockStatus = await getLockScreenStatus();
  if (lockStatus.enabled) {
    return { ok: false, reason: '请使用客户端锁屏密码恢复工作区', status: remoteGuardStatus };
  }
  clearRemoteGuardIncident();
  releaseWorkspaceVisibilityLock();
  return { ok: true, status: remoteGuardStatus };
}

async function startRemoteGuard() {
  if (remoteGuardStarted) return remoteGuardStatus;
  remoteGuardStarted = true;
  powerMonitor.on('lock-screen', () => {
    if (remoteGuardWindowsLockTimer) {
      clearTimeout(remoteGuardWindowsLockTimer);
      remoteGuardWindowsLockTimer = null;
    }
    remoteGuardStatus = {
      ...remoteGuardStatus,
      windowsSessionLocked: true,
      windowsLockState: remoteGuardIncidentLatched ? 'confirmed' : 'idle',
      windowsLockScheduledAt: undefined
    };
    notifyRemoteGuardStatus();
  });
  powerMonitor.on('unlock-screen', () => {
    remoteGuardStatus = {
      ...remoteGuardStatus,
      windowsSessionLocked: false,
      windowsLockState: 'idle',
      windowsLockScheduledAt: undefined
    };
    if (remoteGuardThreatActive && remoteGuardIncidentLatched) {
      showRemoteGuardAlarmWindows();
      scheduleRemoteGuardWindowsLock();
    }
    notifyRemoteGuardStatus();
    void runRemoteGuardScan();
  });
  powerMonitor.on('resume', () => void runRemoteGuardScan());
  const status = await runRemoteGuardScan();
  remoteGuardScanTimer = setInterval(() => void runRemoteGuardScan(), remoteGuardScanIntervalMs);
  return status;
}

function stopRemoteGuard() {
  if (remoteGuardScanTimer) {
    clearInterval(remoteGuardScanTimer);
    remoteGuardScanTimer = null;
  }
  if (remoteGuardWindowsLockTimer) {
    clearTimeout(remoteGuardWindowsLockTimer);
    remoteGuardWindowsLockTimer = null;
  }
  destroyRemoteGuardAlarmWindows();
  stopRemoteGuardAlarmSound();
}

function canShowSignalWindows() {
  return Boolean(
    !workspaceVisibilityGate.locked &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized()
  );
}

async function executeSignalScript(profileId: string, script: string) {
  if (workspaceVisibilityGate.locked) throw new Error('Workspace is locked.');
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
  if (bounds.visible) {
    if (visibleSignalProfileId !== profileId) clearAllSignalCacheRequestState();
    visibleSignalProfileId = profileId;
  } else {
    clearSignalCacheRequestState(signalAppId(profileId));
    if (visibleSignalProfileId === profileId) visibleSignalProfileId = null;
  }
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
  clearSignalCacheRequestState(signalAppId(profileId));
  sendSignalControlMessage(signalAppId(profileId), { type: 'window.hide' });
}

function hideAllSignalWindows() {
  clearAllSignalCacheRequestState();
  for (const appId of signalControlClients.keys()) {
    sendSignalControlMessage(appId, { type: 'window.hide' });
  }
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

function requestSignalWorkspaceSyncBurst() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('signal:sync-workspace');
}

type SignalCacheControlContext = {
  profileId: string;
  client: SignalControlClient;
};

function getSignalCacheControlContext(
  appId: string,
  expectedClient?: SignalControlClient
): SignalCacheControlContext | null {
  const profileId = profileIdFromSignalAppId(appId);
  const client = signalControlClients.get(appId);
  const bounds = pendingSignalWorkspaceBounds.get(profileId);
  if (
    appId !== signalAppId(profileId) ||
    !client ||
    client.socket.destroyed ||
    (expectedClient && client !== expectedClient) ||
    !profileIdPattern.test(profileId) ||
    workspaceVisibilityGate.locked ||
    visibleSignalProfileId !== profileId ||
    bounds?.visible !== true ||
    !canShowSignalWindows()
  ) {
    return null;
  }
  return { profileId, client };
}

function appendSignalCacheResultWithinProtocolLimit(
  payload: SignalCacheResultBatch,
  result: SignalCacheResult
) {
  if (payload.results.length >= signalCacheProtocolMaxBatchSize) return;
  const candidate = { ...payload, results: [...payload.results, result] };
  try {
    validateSignalCacheResultBatch(candidate);
    payload.results.push(result);
  } catch {
    // An invalid or oversized legacy cache entry is a miss, never a reason to expose its contents.
  }
}

function sendEmptySignalCacheResultBatch(
  appId: string,
  requestId: string,
  conversationId: string
) {
  const response = validateSignalCacheResultBatch({
    type: 'translation.cacheResultBatch',
    requestId,
    conversationId,
    results: []
  });
  return sendSignalControlMessage(appId, response);
}

function signalSmartReplyErrorCode(error: unknown): SignalSmartReplyErrorCode {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (/429|busy|already running/i.test(message)) return 'rate-limited';
  if (/timeout|timed out|abort/i.test(`${name} ${message}`)) return 'timeout';
  if (/response|json|reply english|reply chinese|schema|placeholder|punctuation/i.test(message)) {
    return 'invalid-response';
  }
  if (/not configured|missing encrypted|authorization|license|unavailable/i.test(message)) {
    return 'unavailable';
  }
  return 'request-failed';
}

function signalSmartReplyPendingIsCurrent(
  appId: string,
  pending: PendingSignalSmartReplyRequest
) {
  const context = getSignalCacheControlContext(appId, pending.client);
  const activeConversation = activeSignalCacheConversations.get(appId);
  return Boolean(
    context &&
      activeConversation?.client === pending.client &&
      activeConversation.conversationId === pending.conversationId &&
      getPendingSignalSmartReplyRequest(appId, pending.requestId) === pending &&
      pending.state === 'generating' &&
      Date.now() - pending.acceptedAt <= signalSmartReplyRequestTtlMs
  );
}

async function respondToSignalSmartReplyRequest(
  appId: string,
  profileId: string,
  pending: PendingSignalSmartReplyRequest,
  request: SignalSmartReplyRequest
) {
  try {
    const result = await generateSmartRepliesWithDeepSeek({
      requestId: request.requestId,
      userId: `df-${profileId}`,
      profileId,
      platform: 'signal',
      messages: request.messages.map(message => ({
        speaker: message.direction === 'incoming' ? 'other' : 'self',
        text: message.sourceText
      })),
      latestSpeaker: 'other',
      replyCount: 3,
      outputLanguage: 'en-US',
      allowSensitiveEcho: false
    });
    if (!signalSmartReplyPendingIsCurrent(appId, pending)) return;
    sendSignalControlMessage(appId, {
      type: 'smartReply.result',
      requestId: request.requestId,
      contextVersion: signalSmartReplyContextVersion,
      conversationId: request.conversationId,
      trigger: pending.trigger,
      replies: result.replies
    });
  } catch (error) {
    if (!signalSmartReplyPendingIsCurrent(appId, pending)) return;
    sendSignalControlMessage(appId, {
      type: 'smartReply.error',
      requestId: request.requestId,
      contextVersion: signalSmartReplyContextVersion,
      conversationId: request.conversationId,
      trigger: pending.trigger,
      code: signalSmartReplyErrorCode(error)
    });
  } finally {
    if (getPendingSignalSmartReplyRequest(appId, pending.requestId) === pending) {
      pending.state = 'completed';
    }
  }
}

async function respondToSignalVisibleMessageBatch(
  appId: string,
  profileId: string,
  pending: PendingSignalCacheSnapshotRequest,
  batch: SignalVisibleMessageBatch
) {
  try {
    const refreshObservations = new Map(
      batch.messages.map(message => [
        message.messageId,
        observeSignalTranslationRefresh(
          profileId,
          message.conversationId,
          message.messageId
        )
      ])
    );
    if (!isSignalTranslationRefreshTriggerCurrent(profileId, pending)) {
      sendEmptySignalCacheResultBatch(appId, batch.requestId, batch.conversationId);
      return;
    }
    const cacheRequest: TranslationCacheLookupRequest = {
      profileId,
      platform: 'signal',
      contactId: batch.conversationId,
      contactIdType: 'platform',
      sourceHashes: Array.from(new Set(batch.messages.map((message) => message.sourceHash)))
    };
    const markedNonEnglish = pending.acceptanceTrigger?.forceCacheResult === true
      ? false
      : await isMarkedNonEnglishContact(cacheRequest);
    const cachedEntries = markedNonEnglish
      ? []
      : await lookupTranslationCache(cacheRequest);
    if (
      getPendingSignalCacheRequest(appId, batch.requestId) !== pending ||
      !getSignalCacheControlContext(appId, pending.client)
    ) {
      return;
    }
    if (!isSignalTranslationRefreshTriggerCurrent(profileId, pending)) {
      sendEmptySignalCacheResultBatch(appId, batch.requestId, batch.conversationId);
      return;
    }
    const cachedByHash = new Map(cachedEntries.map((entry) => [entry.sourceHash, entry]));
    const response: SignalCacheResultBatch = {
      type: 'translation.cacheResultBatch',
      requestId: batch.requestId,
      conversationId: batch.conversationId,
      results: []
    };
    const visibleCacheMisses: SignalVisibleMessage[] = [];

    const acceptanceTrigger = pending.acceptanceTrigger;
    const messagesToProject = batch.messages.filter(message => {
      if (
        acceptanceTrigger &&
        (
          message.messageId !== acceptanceTrigger.messageId ||
          message.sourceHash !== acceptanceTrigger.sourceHash
        )
      ) {
        return false;
      }
      if (acceptanceTrigger?.refreshTaskKey) return true;
      const observed = refreshObservations.get(message.messageId);
      return Boolean(
        observed &&
          isSignalTranslationRefreshObservationSettled(
            profileId,
            message.conversationId,
            message.messageId,
            observed
          )
      );
    });
    for (const message of messagesToProject) {
      const cached = cachedByHash.get(message.sourceHash);
      if (
        !cached ||
        typeof cached.sourceText !== 'string' ||
        typeof cached.translatedText !== 'string' ||
        normalizeSignalCacheSourceText(message.sourceText) !== normalizeSignalCacheSourceText(cached.sourceText) ||
        !isUsefulSignalCacheTranslation(message.sourceText, cached.translatedText)
      ) {
        if (!acceptanceTrigger && !markedNonEnglish) {
          visibleCacheMisses.push(message);
        }
        continue;
      }
      appendSignalCacheResultWithinProtocolLimit(response, {
        conversationId: message.conversationId,
        messageId: message.messageId,
        sourceHash: message.sourceHash,
        sourceText: message.sourceText,
        translatedText: cached.translatedText
      });
    }

    validateSignalCacheResultBatch(response);
    if (
      getPendingSignalCacheRequest(appId, batch.requestId) !== pending ||
      !getSignalCacheControlContext(appId, pending.client)
    ) {
      return;
    }
    const sent = sendSignalControlMessage(appId, response);
    if (sent && !acceptanceTrigger) {
      for (const message of visibleCacheMisses) {
        if (
          enqueueSignalLiveTranslation(
            appId,
            profileId,
            pending.client,
            message
          )
        ) {
          appendSignalSourceOnlyAcceptanceStage('queue-accepted');
        }
      }
    }
    const triggerResult = response.results[0];
    if (
      sent &&
      pending.acceptanceTrigger &&
      response.results.length === 1 &&
      triggerResult?.messageId === pending.acceptanceTrigger.messageId &&
      triggerResult.sourceHash === pending.acceptanceTrigger.sourceHash
    ) {
      pending.acceptanceTrigger.resultSent = true;
      appendSignalSourceOnlyAcceptanceStage('trigger-result-sent');
    }
  } catch {
    if (
      getPendingSignalCacheRequest(appId, batch.requestId) === pending &&
      getSignalCacheControlContext(appId, pending.client)
    ) {
      try {
        sendEmptySignalCacheResultBatch(appId, batch.requestId, batch.conversationId);
      } catch {
        // The authenticated socket closed while the request-scoped cache miss was sent.
      }
    }
  } finally {
    // Keep the bounded request marker after completion so the same requestId cannot
    // be replayed. Conversation switch, hide, lock, transport lifecycle, or bounded
    // eviction clears it without retaining any message body.
    pending.state = 'completed';
    releaseSignalCacheLookupSlot(appId);
  }
}

function handleSignalControlMessage(appId: string, message: Record<string, unknown>) {
  const client = signalControlClients.get(appId);
  if (client) client.lastSeenAt = Date.now();

  try {
    const cacheContext = getSignalCacheControlContext(appId, client);
    if (client && message.type === 'conversation.changed') {
      appendSignalSourceOnlyAcceptanceStage('conversation-envelope-received');
      let changed: ReturnType<typeof validateSignalConversationChangedMessage> | null = null;
      try {
        changed = validateSignalConversationChangedMessage(message);
      } catch {
        appendSignalSourceOnlyAcceptanceStage('conversation-invalid');
      }
      if (changed && !cacheContext) {
        appendSignalSourceOnlyAcceptanceStage('conversation-rejected-cache-context');
      } else if (changed && cacheContext) {
        const snapshotRequest = validateSignalMessageSnapshotRequest({
          type: 'message.snapshot.request',
          requestId: randomUUID()
        });
        clearSignalCacheRequestState(appId);
        activeSignalCacheConversations.set(appId, {
          conversationId: changed.conversationId,
          client: cacheContext.client
        });
        appendSignalSourceOnlyAcceptanceStage('conversation-active');
        const pendingStored = setPendingSignalCacheRequest(appId, {
          requestId: snapshotRequest.requestId,
          conversationId: changed.conversationId,
          client: cacheContext.client,
          state: 'pending'
        });
        if (pendingStored && !sendSignalControlMessage(appId, snapshotRequest)) {
          deletePendingSignalCacheRequest(appId, snapshotRequest.requestId);
        }
      }
    }
    if (client && message.type === 'message.added') {
      appendSignalSourceOnlyAcceptanceStage('message-envelope-received');
      let added: ReturnType<typeof validateSignalMessageAdded> | null = null;
      try {
        added = validateSignalMessageAdded(message);
        appendSignalSourceOnlyAcceptanceStage('message-received');
      } catch {
        appendSignalSourceOnlyAcceptanceStage('message-invalid');
      }
      const activeConversation = activeSignalCacheConversations.get(appId);
      if (added && !cacheContext) {
        appendSignalSourceOnlyAcceptanceStage('message-rejected-cache-context');
      } else if (
        added &&
        cacheContext &&
        (
          activeConversation?.client !== cacheContext.client ||
          activeConversation.conversationId !== added.conversationId
        )
      ) {
        appendSignalSourceOnlyAcceptanceStage('message-rejected-active-conversation');
      } else if (added && cacheContext) {
        appendSignalSourceOnlyAcceptanceStage('message-accepted');
        const queued = enqueueSignalLiveTranslation(
          appId,
          cacheContext.profileId,
          cacheContext.client,
          added
        );
        appendSignalSourceOnlyAcceptanceStage(queued ? 'queue-accepted' : 'queue-rejected');
      }
    }
    if (
      client &&
      message.type === 'translation.refresh.request'
    ) {
      let refresh: ReturnType<typeof validateSignalTranslationRefreshRequest> | null = null;
      try {
        refresh = validateSignalTranslationRefreshRequest(message);
      } catch {
        // Strictly reject malformed or non-canonical refresh requests without logging payload data.
      }
      const activeConversation = activeSignalCacheConversations.get(appId);
      if (
        refresh &&
        cacheContext &&
        activeConversation?.client === cacheContext.client &&
        activeConversation.conversationId === refresh.conversationId
      ) {
        enqueueSignalTranslationRefresh(
          appId,
          cacheContext.profileId,
          cacheContext.client,
          refresh
        );
      }
    }
    if (client && message.type === 'smartReply.request') {
      let request: SignalSmartReplyRequest | null = null;
      try {
        request = validateSignalSmartReplyRequest(message);
      } catch {
        // Reject malformed or non-canonical smart reply requests without logging message bodies.
      }
      const activeConversation = activeSignalCacheConversations.get(appId);
      if (
        request &&
        cacheContext &&
        activeConversation?.client === cacheContext.client &&
        activeConversation.conversationId === request.conversationId
      ) {
        const trigger = request.messages.at(-1);
        if (trigger) {
          const pending: PendingSignalSmartReplyRequest = {
            requestId: request.requestId,
            conversationId: request.conversationId,
            trigger,
            client: cacheContext.client,
            state: 'generating',
            acceptedAt: Date.now()
          };
          if (setPendingSignalSmartReplyRequest(appId, pending)) {
            void respondToSignalSmartReplyRequest(
              appId,
              cacheContext.profileId,
              pending,
              request
            );
          }
        }
      }
    }
    if (cacheContext && message.type === 'message.visibleBatch') {
      const batch = validateSignalVisibleMessageBatch(message);
      const activeConversation = activeSignalCacheConversations.get(appId);
      let pending = getPendingSignalCacheRequest(appId, batch.requestId);
      if (
        activeConversation?.client === cacheContext.client &&
        activeConversation.conversationId === batch.conversationId &&
        (!pending || (
          pending.client === cacheContext.client &&
          pending.conversationId === batch.conversationId
        ))
      ) {
        if (!pending) {
          const candidate: PendingSignalCacheSnapshotRequest = {
            requestId: batch.requestId,
            conversationId: batch.conversationId,
            client: cacheContext.client,
            state: 'pending'
          };
          if (setPendingSignalCacheRequest(appId, candidate)) pending = candidate;
        }
        if (pending?.state === 'pending') {
          const acceptanceTrigger = pending.acceptanceTrigger;
          if (
            acceptanceTrigger &&
            batch.messages.some(message =>
              message.messageId === acceptanceTrigger.messageId &&
              message.sourceHash === acceptanceTrigger.sourceHash
            )
          ) {
            appendSignalSourceOnlyAcceptanceStage('visible-batch-accepted');
          }
          if (!tryAcquireSignalCacheLookupSlot(appId)) {
            pending.state = 'completed';
            try {
              sendEmptySignalCacheResultBatch(appId, batch.requestId, batch.conversationId);
            } catch {
              // The authenticated socket closed while the request-scoped cache miss was sent.
            }
          } else {
            pending.state = 'responding';
            void respondToSignalVisibleMessageBatch(
              appId,
              cacheContext.profileId,
              pending,
              batch
            );
          }
        }
      }
    }
    if (cacheContext && message.type === 'translation.cacheResultApplied') {
      const applied = validateSignalCacheResultAppliedMessage(message);
      const pending = getPendingSignalCacheRequest(appId, applied.requestId);
      if (
        pending?.client === cacheContext.client &&
        pending.acceptanceTrigger?.resultSent === true &&
        applied.appliedCount === 1
      ) {
        appendSignalSourceOnlyAcceptanceStage('result-applied');
        appendSignalSourceOnlyAcceptanceStage('completed');
        pending.acceptanceTrigger = undefined;
      }
    }
    if (message.type === 'heartbeat') {
      sendSignalControlMessage(appId, { type: 'heartbeat.ack', at: Date.now() });
    }
    if (
      message.type === 'security.visibility-applied' &&
      typeof message.locked === 'boolean' &&
      Number.isSafeInteger(message.revision) &&
      Number.isSafeInteger(message.visibleWindowCount)
    ) {
      const applied =
        message.locked === workspaceVisibilityGate.locked &&
        message.revision === workspaceVisibilityGate.revision &&
        (!message.locked || message.visibleWindowCount === 0);
      settleSignalVisibilityApplied(appId, Number(message.revision), applied);
    }
    if (message.type === 'ready') {
      const profileId = profileIdFromSignalAppId(appId);
      const bounds = pendingSignalWorkspaceBounds.get(profileId);
      sendSignalOwner(appId);
      sendSignalVisibilityState(appId);
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
    signalSourceOnlyAcceptanceSummaryPath(),
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
  let executable: string;
  let child: ChildProcess;
  try {
    executable = await resolveSignalExecutable();
    child = spawn(executable, args, {
      stdio: 'ignore',
      windowsHide: false,
      env: runtimeLoggingEnabled
        ? {
            ...process.env,
            MAOYI_SIGNAL_GUARD_DIAGNOSTIC: join(dataDir, 'df-guard-debug.json')
          }
        : undefined
    });
  } catch (error) {
    await credentialPipe.close();
    throw error;
  }
  try {
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const handleSpawn = () => {
        child.off('error', handleError);
        resolveSpawn();
      };
      const handleError = (error: Error) => {
        child.off('spawn', handleSpawn);
        rejectSpawn(error);
      };
      child.once('spawn', handleSpawn);
      child.once('error', handleError);
    });
  } catch (error) {
    await credentialPipe.close();
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Signal process failed to start: ${detail}`);
  }
  child.on('error', (error) => {
    if (runtimeLoggingEnabled) console.error('Signal child process error:', error.message);
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

async function saveTranslationCacheEntry(
  request: TranslationCacheSetRequest,
  shouldContinue: () => boolean = () => true,
  options: { bypassNonEnglishContactGuard?: boolean } = {}
): Promise<boolean> {
  if (
    !request.profileId ||
    !request.sourceHash ||
    !request.translatedText ||
    !isEnglishChatSource(request.sourceText) ||
    !shouldContinue()
  ) {
    return false;
  }
  if (
    (!options.bypassNonEnglishContactGuard && await isMarkedNonEnglishContact(request)) ||
    !shouldContinue()
  ) {
    return false;
  }
  const queueKey = translationCacheWriteQueueKey(request);
  const previousWrite = translationCacheWriteQueues.get(queueKey) ?? Promise.resolve(true);
  const nextWrite = previousWrite
    .catch(() => false)
    .then(async () => {
      if (!shouldContinue()) return false;
      await saveTranslationCacheEntryNow(request);
      return true;
    });
  translationCacheWriteQueues.set(queueKey, nextWrite);
  try {
    return await nextWrite;
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

async function translateWithDeepSeek(
  request: TranslateRequest,
  abortSignal?: AbortSignal,
  logPolicy: 'standard' | 'content-free' = 'standard'
): Promise<string> {
  if (abortSignal?.aborted) throw new Error('Translation request was cancelled.');
  const config = await readConfig();
  const deepseekApiKey = clientLicenseManager?.getServiceSecret() || await readDevelopmentServiceSecret();
  if (abortSignal?.aborted) throw new Error('Translation request was cancelled.');
  if (!deepseekApiKey) {
    throw new Error('DeepSeek API key is not configured.');
  }

  const requestId = request.requestId || randomUUID();
  const userId = (request.userId || (request.profileId ? `df-${request.profileId}` : 'df-default'))
    .replace(/[^a-zA-Z0-9\-_]/g, '_')
    .slice(0, 512);
  const logBase = logPolicy === 'content-free'
    ? {
        from: request.from || '',
        to: request.to,
        reason: request.reason || '',
        platform: request.platform || '',
        direction: request.direction || '',
        messagePart: request.messagePart || ''
      }
    : {
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
  const sensitiveTokenProtection = protectTranslationSensitiveTokens(
    request.text || '',
    randomBytes(12).toString('hex')
  );
  const translationPrompts = await loadTranslationPrompts(deepseekApiKey);

  const translateOnce = async (retry: boolean) => {
    if (abortSignal?.aborted) throw new Error('Translation request was cancelled.');
    const systemPrompt = isComposerEnglishRequest
      ? translationPrompts.chineseToEnglish
      : translationPrompts.englishToChinese;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: abortSignal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deepseekApiKey}`
      },
      body: JSON.stringify({
        model: config.deepseekModel || defaultModel,
        user_id: userId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sensitiveTokenProtection.text }
        ],
        thinking: { type: 'disabled' },
        temperature: retry ? (isComposerEnglishRequest ? 0.05 : 0.1) : 0.2
      })
    });

    if (!response.ok) {
      await appendTranslateRequestLog({ ...logBase, status: 'failed', httpStatus: response.status, retry });
      throw new Error(`DeepSeek request failed: ${response.status}`);
    }

    const data = await response.json();
    const rawTranslation = data.choices?.[0]?.message?.content?.trim() || '';
    const styledTranslation = isComposerEnglishRequest
      ? normalizeComposerEnglishStyle(rawTranslation)
      : rawTranslation;
    const restored = restoreTranslationSensitiveTokens(styledTranslation, sensitiveTokenProtection);
    if (!restored.ok) {
      const error = new Error(restored.reason);
      error.name = 'SensitiveTranslationTokenIntegrityError';
      throw error;
    }
    return restored.text;
  };

  const translationPromptLeakPattern = /(?:translate the following chat message|return only the translated message|keep\s+emojis?,?\s*urls|请将以下英文聊天信息翻译成中文|(?:保留|保持)\s*表情符号|你是一名(?:中译英|英译中)聊天翻译助手|只输出(?:英文|中文)译文|普通英文单词和短语必须翻译|保持原有换行和空行结构|敏感信息占位符必须原样保留|仅返回翻译后的信息|无需解释)/i;
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
    let translated: string;
    try {
      translated = await translateOnce(false);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'SensitiveTranslationTokenIntegrityError') throw error;
      await appendTranslateRequestLog({ ...logBase, status: 'retry-sensitive-token-integrity' });
      translated = await translateOnce(true);
    }
    const wantsChinese = /Chinese|zh|Simplified/i.test(request.to || '');
    const sourceHasLatin = /[A-Za-z]{2,}/.test(request.text || '');
    if (wantsChinese) translated = sanitizeChineseTranslation(translated);
    const translatedHasChinese = /[\u4e00-\u9fff]/.test(translated);
    if (wantsChinese && sourceHasLatin && translated && !translatedHasChinese) {
      await appendTranslateRequestLog({ ...logBase, status: 'retry-chinese', translatedLength: translated.length });
      translated = sanitizeChineseTranslation(await translateOnce(true));
    }
    if (isComposerEnglishRequest) {
      translated = sanitizeComposerEnglishTranslation(translated);
      if (isSuspiciousComposerEnglish(translated) || !composerLayoutMatches(request.text || '', translated)) {
        await appendTranslateRequestLog({ ...logBase, status: 'retry-composer-faithful', translatedLength: translated.length });
        translated = sanitizeComposerEnglishTranslation(await translateOnce(true));
      }
      if (isSuspiciousComposerEnglish(translated)) throw new Error('Composer translation expanded beyond the source.');
      translated = restoreComposerEnglishLayout(request.text || '', translated);
      if (!composerLayoutMatches(request.text || '', translated)) throw new Error('Composer translation did not preserve source line layout.');
    }
    await appendTranslateRequestLog({ ...logBase, status: 'success', translatedLength: translated.length });
    registerApprovedComposerTranslation(request, requestId, translated);
    return translated;
  };

  const dedupeKey = request.reason === 'visible-message' && request.profileId && request.sourceHash
    ? JSON.stringify([
        request.profileId,
        request.to,
        request.sourceHash,
        createHash('sha256').update(request.text || '', 'utf8').digest('base64url')
      ])
    : '';
  if (!dedupeKey || abortSignal) return runDeepSeekTranslation();

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

const smartReplyInFlightProfiles = new Set<string>();
let smartReplyInFlightCount = 0;
const smartReplyRequestTimeoutMs = 25_000;
const smartReplyTransientStatuses = new Set([429, 502, 503, 504]);

async function generateSmartRepliesWithDeepSeek(request: SmartReplyRequest): Promise<SmartReplyResult> {
  const validated = validateSmartReplyRequest(request);
  const profileGate = validated.profileId || '__default__';
  if (smartReplyInFlightProfiles.has(profileGate)) {
    throw new Error('A smart reply request is already running for this profile.');
  }
  if (smartReplyInFlightCount >= 2) throw new Error('Smart reply is busy. Please try again shortly.');

  smartReplyInFlightProfiles.add(profileGate);
  smartReplyInFlightCount += 1;
  try {
    const config = await readConfig();
    const deepseekApiKey = clientLicenseManager?.getServiceSecret() || await readDevelopmentServiceSecret();
    if (!deepseekApiKey) throw new Error('DeepSeek API key is not configured.');
    const { prompt } = await loadSmartReplyPrompt(deepseekApiKey);
    const protectedTranscript = buildProtectedSmartReplyTranscript(validated);
    const userId = (validated.userId || (validated.profileId ? `df-${validated.profileId}` : 'df-smart-reply'))
      .replace(/[^a-zA-Z0-9\-_]/g, '_')
      .slice(0, 256);
    const input = JSON.stringify(protectedTranscript.payload);
    const deadline = Date.now() + smartReplyRequestTimeoutMs;
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remainingMs);
      try {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${deepseekApiKey}`
          },
          body: JSON.stringify({
            model: config.deepseekModel || defaultModel,
            user_id: userId,
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: input }
            ],
            response_format: { type: 'json_object' },
            thinking: { type: 'disabled' },
            temperature: attempt === 0 ? 0.65 : 0.2,
            max_tokens: 1_000,
            stream: false
          })
        });
        const declaredResponseBytes = Number(response.headers.get('content-length') || '0');
        if (Number.isFinite(declaredResponseBytes) && declaredResponseBytes > 512 * 1024) {
          await response.body?.cancel();
          throw new Error('DeepSeek smart reply response is too large.');
        }
        const rawBody = await response.text();
        if (Buffer.byteLength(rawBody, 'utf8') > 512 * 1024) {
          throw new Error('DeepSeek smart reply response is too large.');
        }
        if (!response.ok) {
          const error = new Error(`DeepSeek smart reply request failed: ${response.status}`);
          error.name = smartReplyTransientStatuses.has(response.status) ? 'TransientSmartReplyError' : 'PermanentSmartReplyError';
          throw error;
        }
        let data: unknown;
        try {
          data = JSON.parse(rawBody);
        } catch {
          throw new Error('DeepSeek smart reply envelope is not valid JSON.');
        }
        const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
          ?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') throw new Error('DeepSeek smart reply content is missing.');
        return parseSmartReplyResponse(content);
      } catch (error) {
        lastError = error;
        if (error instanceof Error && error.name === 'PermanentSmartReplyError') throw error;
        if (attempt === 1 || Date.now() >= deadline) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError instanceof Error && lastError.name === 'AbortError') {
      throw new Error('Smart reply request timed out.');
    }
    throw lastError instanceof Error ? lastError : new Error('Smart reply request failed.');
  } finally {
    smartReplyInFlightProfiles.delete(profileGate);
    smartReplyInFlightCount = Math.max(0, smartReplyInFlightCount - 1);
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
  targetWindow.once('unmaximize', () => {
    if (!targetWindow.isDestroyed() && !targetWindow.isMaximized()) targetWindow.setBounds(compactBounds);
  });
  targetWindow.unmaximize();
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
  trustedHandle('client-license:replace', true, async (_event, licenseCode: string) => {
    if (!clientLicenseManager) throw new Error('客户端授权模块尚未初始化');
    const oldServiceSecret = clientLicenseManager.getServiceSecret();
    if (!oldServiceSecret) {
      return { ok: false, reason: '当前授权密钥不可用，不能重新授权', status: clientLicenseManager.getStatus() };
    }
    const preparation = await clientLicenseManager.prepareReplacement(assertText(licenseCode, 'License code', 32 * 1024));
    if (!preparation.result.ok || !preparation.prepared) {
      if (preparation.result.selfDestructRequired) await beginAuthorizationSelfDestruct();
      return preparation.result;
    }

    let prompts: TranslationPrompts;
    let pendingRaw = '';
    let smartPrompt: SmartReplyPrompt | null = null;
    let smartPendingRaw = '';
    const previousActiveRaw = await readOptionalText(activeTranslationPromptPath());
    const previousSmartActiveRaw = await readOptionalText(activeSmartReplyPromptPath());
    try {
      prompts = await loadTranslationPrompts(oldServiceSecret);
      pendingRaw = encryptTranslationPromptBundle(preparation.prepared.payload.serviceSecret, prompts);
      await writeTextAtomic(pendingTranslationPromptPath(), pendingRaw);
      if (await smartReplyPromptBundleExists()) {
        smartPrompt = await loadSmartReplyPrompt(oldServiceSecret);
        smartPendingRaw = encryptSmartReplyPromptBundle(preparation.prepared.payload.serviceSecret, smartPrompt);
        await writeTextAtomic(pendingSmartReplyPromptPath(), smartPendingRaw);
      }
    } catch (error) {
      await rm(pendingTranslationPromptPath(), { force: true });
      await rm(pendingSmartReplyPromptPath(), { force: true });
      return {
        ok: false,
        reason: error instanceof Error ? `提示词密钥迁移失败：${error.message}` : '提示词密钥迁移失败',
        status: clientLicenseManager.getStatus()
      };
    }

    let snapshot: ClientLicenseSnapshot | undefined;
    try {
      snapshot = await clientLicenseManager.commitReplacement(preparation.prepared);
      await writeTextAtomic(activeTranslationPromptPath(), pendingRaw);
      if (smartPendingRaw) await writeTextAtomic(activeSmartReplyPromptPath(), smartPendingRaw);
      await rm(pendingTranslationPromptPath(), { force: true });
      await rm(pendingSmartReplyPromptPath(), { force: true });
      translationPromptsCache = prompts;
      smartReplyPromptCache = smartPrompt;
      return { ok: true, status: clientLicenseManager.getStatus() };
    } catch (error) {
      let rollbackCompleted = false;
      if (snapshot) {
        try {
          await clientLicenseManager.rollbackReplacement(snapshot);
          if (previousActiveRaw) await writeTextAtomic(activeTranslationPromptPath(), previousActiveRaw);
          else await rm(activeTranslationPromptPath(), { force: true });
          if (previousSmartActiveRaw) await writeTextAtomic(activeSmartReplyPromptPath(), previousSmartActiveRaw);
          else await rm(activeSmartReplyPromptPath(), { force: true });
          translationPromptsCache = prompts;
          smartReplyPromptCache = smartPrompt;
          rollbackCompleted = true;
        } catch {
          // Pending prompt files remain available for startup recovery if authorization rollback cannot complete.
        }
      }
      if (!snapshot || rollbackCompleted) {
        await rm(pendingTranslationPromptPath(), { force: true });
        await rm(pendingSmartReplyPromptPath(), { force: true });
      }
      return {
        ok: false,
        reason: error instanceof Error ? `重新授权未完成：${error.message}` : '重新授权未完成',
        status: clientLicenseManager.getStatus()
      };
    }
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
  trustedHandle('signal:source-only-acceptance', true, () => signalSourceOnlyAcceptanceActive);
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
  trustedHandle('smart-reply:generate', true, (_event, request: SmartReplyRequest) =>
    generateSmartRepliesWithDeepSeek(validateSmartReplyRequest(request))
  );
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
  trustedHandle('lock-screen:engage', true, () => engageWorkspaceVisibilityLock());
  trustedHandle('lock-screen:check-network-offline', true, () => checkNetworkOffline());
  trustedHandle('lock-screen:authorize-pin-change', true, (event, mode: LockScreenPinChangeMode) => {
    if (mode !== 'setup' && mode !== 'reset' && mode !== 'upgrade') {
      throw new Error('锁屏凭据设置模式无效');
    }
    return authorizeLockScreenPinChange(event.sender.id, mode);
  });
  trustedHandle('lock-screen:set-pin', true, (event, pin: string, token: string) =>
    setLockScreenPin(
      event.sender.id,
      assertText(pin, 'Lock credential', 32),
      assertText(token, 'Lock credential authorization', 256)
    )
  );
  trustedHandle('lock-screen:unlock', true, (_event, pin: string) => unlockLockScreen(assertText(pin, 'Lock credential', 32)));
  trustedHandle('remote-guard:status', false, () => remoteGuardStatus);
  trustedHandle('remote-guard:scan-now', false, () => runRemoteGuardScan(true));
  trustedHandle('remote-guard:acknowledge', false, () => acknowledgeRemoteGuardIncident());
  trustedHandle('window:set-theme', true, (_event, theme: 'blackGold' | 'pink') => {
    if (theme !== 'blackGold' && theme !== 'pink') throw new Error('Theme is invalid.');
  });
  trustedHandle('clipboard:read-text', true, () => clipboard.readText().slice(0, 1024 * 1024));
  trustedHandle('clipboard:write-text', true, (_event, text: string) => {
    clipboard.writeText(assertText(text, 'Clipboard text', 1024 * 1024, true));
  });
  trustedHandle('window:minimize', false, (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
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
  signalSourceOnlyAcceptanceActive = resolveSignalSourceOnlyAcceptance();
  if (signalSourceOnlyAcceptanceActive) {
    await resolveSignalExecutable();
    initializeSignalSourceOnlyAcceptanceDiagnostics();
  }
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
  // Windows hides and restores authenticated owned Signal windows with their owner.
  // Sending an additional window.hide here can restore only the native surface and
  // leave Chromium white until the profile is switched.
  mainWindow.on('hide', () => {
    hideAllSignalWindows();
  });
  mainWindow.on('close', (event) => {
    if (!remoteGuardIncidentLatched || signalShutdownBeforeQuitDone) return;
    event.preventDefault();
    showRemoteGuardAlarmWindows();
    startRemoteGuardAlarmSound();
    focusMainWindowForRemoteGuardRecovery();
  });
  mainWindow.on('restore', requestSignalWorkspaceSyncBurst);
  mainWindow.on('show', requestSignalWorkspaceSyncBurst);
  mainWindow.on('focus', requestSignalWorkspaceSyncBurst);
  mainWindow.on('move', scheduleVisibleSignalMoveSync);
  mainWindow.on('resized', requestSignalWorkspaceSyncBurst);

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
    await startRemoteGuard();
    releaseWorkspaceVisibilityLock();
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
    stopRemoteGuard();
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
