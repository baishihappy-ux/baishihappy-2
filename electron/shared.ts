export type Platform = 'whatsapp' | 'telegram-a' | 'telegram-k' | 'signal';
export type WorkspaceApp = 'whatsapp' | 'telegram' | 'signal';
export type LastActiveProfileIds = Record<WorkspaceApp, string | null>;

export const legacyWhatsAppChrome130UserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export function buildWindowsChromiumUserAgent(chromiumVersion: string) {
  const match = /^([1-9]\d{0,3})\.\d+\.\d+\.\d+$/.exec(chromiumVersion);
  if (!match) throw new Error('Chromium runtime version is invalid.');
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${match[1]}.0.0.0 Safari/537.36`;
}

export function resolveProfileUserAgent(
  platform: Platform,
  configuredUserAgent: unknown,
  platformDefault: string
) {
  if (typeof configuredUserAgent !== 'string' || !configuredUserAgent.trim()) {
    return platformDefault;
  }
  if (
    platform === 'whatsapp' &&
    configuredUserAgent === legacyWhatsAppChrome130UserAgent
  ) {
    return platformDefault;
  }
  return configuredUserAgent;
}

export type PlatformInfo = {
  platform: Platform;
  label: string;
  url: string;
};

export type FingerprintProfile = {
  fingerprintId: string;
  userAgent: string;
  languageSource: 'ip' | 'custom';
  languages: string[];
  timezoneSource: 'ip' | 'custom';
  timezone: string;
  webglVendor: string;
  webglRenderer: string;
  hardwareSource: 'match' | 'custom';
  hardwareConcurrency: number;
  deviceMemory: number;
  canvasSeed: number;
  screenSource: 'match' | 'custom';
  width: number;
  height: number;
};

export type ChatProfile = {
  id: string;
  name: string;
  group: string;
  platform: Platform;
  partition: string;
  signalDataDir?: string;
  createdAt: number;
  fingerprint: FingerprintProfile;
};

export type AppConfig = {
  profiles: ChatProfile[];
  activeProfileId: string | null;
  profileTabOrder: string[];
  lastActiveProfileIds: LastActiveProfileIds;
  deepseekModel: string;
};

export function workspaceAppForPlatform(platform: Platform): WorkspaceApp {
  if (platform === 'whatsapp') return 'whatsapp';
  if (platform === 'signal') return 'signal';
  return 'telegram';
}

export function defaultProfileTabOrder(profiles: ChatProfile[]) {
  const result: string[] = [];
  for (const app of ['whatsapp', 'telegram', 'signal'] as const) {
    const appProfiles = profiles.filter((profile) => workspaceAppForPlatform(profile.platform) === app);
    const groupOrder = new Map<string, number>();
    for (const profile of appProfiles) {
      const group = profile.group.trim() || '本组';
      if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size);
    }
    appProfiles.sort((left, right) => {
      const leftGroup = left.group.trim() || '本组';
      const rightGroup = right.group.trim() || '本组';
      const groupDifference = (groupOrder.get(leftGroup) ?? 0) - (groupOrder.get(rightGroup) ?? 0);
      return groupDifference || left.createdAt - right.createdAt || left.id.localeCompare(right.id);
    });
    result.push(...appProfiles.map((profile) => profile.id));
  }
  return result;
}

export function sanitizeProfileTabOrder(profiles: ChatProfile[], rawOrder: unknown) {
  const validIds = new Set(profiles.map((profile) => profile.id));
  const seen = new Set<string>();
  const result: string[] = [];
  if (Array.isArray(rawOrder)) {
    for (const value of rawOrder) {
      if (typeof value !== 'string' || !validIds.has(value) || seen.has(value)) continue;
      seen.add(value);
      result.push(value);
    }
  }
  for (const id of defaultProfileTabOrder(profiles)) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function sanitizeLastActiveProfileIds(
  profiles: ChatProfile[],
  rawState: unknown,
  activeProfileId: string | null,
  profileTabOrder: string[]
): LastActiveProfileIds {
  const source = rawState && typeof rawState === 'object'
    ? rawState as Partial<Record<WorkspaceApp, unknown>>
    : {};
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const activeProfile = activeProfileId ? byId.get(activeProfileId) : undefined;
  const result = {} as LastActiveProfileIds;
  for (const app of ['whatsapp', 'telegram', 'signal'] as const) {
    const candidate = typeof source[app] === 'string' ? source[app] : null;
    const candidateProfile = candidate ? byId.get(candidate) : undefined;
    if (candidateProfile && workspaceAppForPlatform(candidateProfile.platform) === app) {
      result[app] = candidate;
      continue;
    }
    if (activeProfile && workspaceAppForPlatform(activeProfile.platform) === app) {
      result[app] = activeProfile.id;
      continue;
    }
    result[app] = profileTabOrder.find((id) => {
      const profile = byId.get(id);
      return profile && workspaceAppForPlatform(profile.platform) === app;
    }) ?? null;
  }
  return result;
}

export type SignalTranslationAcceptancePolicy = {
  legacyBubbleEnabled: boolean;
  composerEnabled: boolean;
};

export function signalTranslationAcceptancePolicy(
  platform: Platform,
  _sourceOnlyAcceptance = false
): SignalTranslationAcceptancePolicy {
  return {
    // Signal v8.18.0 renders translations and its refresh control in the
    // source-owned message component. Never install the former DOM bubble
    // scanner/injector alongside it. Composer translation remains bridged
    // until that workflow is migrated into the Signal source separately.
    legacyBubbleEnabled: platform !== 'signal',
    composerEnabled: true
  };
}

export const signalSourceOnlyAcceptanceStages = [
  'mode-active',
  'conversation-envelope-received',
  'conversation-invalid',
  'conversation-rejected-cache-context',
  'conversation-active',
  'message-envelope-received',
  'message-invalid',
  'message-received',
  'message-rejected-cache-context',
  'message-rejected-active-conversation',
  'message-accepted',
  'queue-accepted',
  'queue-rejected',
  'cache-lookup',
  'cache-hit',
  'api-start',
  'api-success',
  'cache-saved',
  'snapshot-request-sent',
  'visible-batch-accepted',
  'trigger-result-sent',
  'result-applied',
  'completed',
  'retry-scheduled',
  'failed'
] as const;

export type SignalSourceOnlyAcceptanceStage =
  (typeof signalSourceOnlyAcceptanceStages)[number];

export type SignalSourceOnlyAcceptanceStageCounts = Record<
  SignalSourceOnlyAcceptanceStage,
  number
>;

export function buildSignalSourceOnlyAcceptanceDiagnostic(
  stage: SignalSourceOnlyAcceptanceStage,
  stageCounts: SignalSourceOnlyAcceptanceStageCounts,
  elapsedMs: number
) {
  const boundedInteger = (value: number, maximum: number) =>
    Math.max(0, Math.min(maximum, Number.isSafeInteger(value) ? value : 0));
  const stages = Object.fromEntries(
    signalSourceOnlyAcceptanceStages.map((stageName) => [
      stageName,
      boundedInteger(stageCounts[stageName], 1_000_000)
    ])
  ) as SignalSourceOnlyAcceptanceStageCounts;
  return {
    schemaVersion: 1,
    type: 'source-only-acceptance-summary',
    baseline: '8.18.0',
    patchSetSha256: 'BF482ACA5FEB79AFD4B0C418E56DF41BEA3C38F284EF8FBDB64C1BF17F5D2650',
    mode: 'source-only',
    legacyBubbleEnabled: false,
    composerEnabled: true,
    elapsedMs: boundedInteger(elapsedMs, 24 * 60 * 60 * 1000),
    lastStage: stage,
    stages
  } as const;
}

export type MemoryStatus = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
};

export type SignalWorkspaceBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type TranslateRequest = {
  requestId?: string;
  userId?: string;
  text: string;
  from?: string;
  to: string;
  reason?: string;
  profileId?: string;
  profileName?: string;
  platform?: Platform;
  sourceHash?: string;
  messageKey?: string;
  contactId?: string;
  contactIdType?: 'phone' | 'platform' | 'title' | 'unknown';
  contactTitle?: string;
  direction?: 'incoming' | 'outgoing' | 'unknown';
  messagePart?: 'body' | 'quote';
};

export type SmartReplySpeaker = 'self' | 'other';

export type SmartReplyMessage = {
  speaker: SmartReplySpeaker;
  text: string;
};

export type SmartReplyRequest = {
  requestId?: string;
  userId?: string;
  profileId?: string;
  platform?: Platform;
  messages: SmartReplyMessage[];
  latestSpeaker: 'other';
  replyCount: 3;
  outputLanguage: 'en-US';
  allowSensitiveEcho: false;
};

export type SmartReplySuggestion = {
  id: 'reply_1' | 'reply_2' | 'reply_3';
  english: string;
  chinese: string;
};

export type SmartReplyResult = {
  schema_version: 'df.smart_reply.output.v1';
  replies: SmartReplySuggestion[];
};

export type SendAuthorizationRequest = {
  requestId: string;
  profileId: string;
  platform: Platform;
  conversationSignature?: string;
  text: string;
};

export type SendAuthorizationResult = {
  ok: boolean;
  reason?: string;
};

export type SensitiveSendKind = 'numeric-account' | 'usdt-wallet';
export type WalletNetwork = 'TRC20' | 'ERC20' | 'BEP20' | 'Solana';

export type SensitiveSendRequest = {
  profileId: string;
  platform: Platform;
  conversationSignature: string;
  text: string;
};

export type SensitiveSendPrepareRequest = SensitiveSendRequest & {
  network?: WalletNetwork;
};

export type SensitiveSendPrepareResult = {
  ok: boolean;
  token?: string;
  kind?: SensitiveSendKind;
  network?: WalletNetwork;
  expiresAt?: number;
  reason?: string;
};

export type SensitiveSendAuthorizeRequest = SensitiveSendRequest & {
  token: string;
  network?: WalletNetwork;
};

export type TranslationCacheEntry = {
  sourceHash: string;
  sourceText?: string;
  translatedText: string;
  updatedAt: number;
  platform?: Platform;
  profileId?: string;
  profileName?: string;
  contactId?: string;
  contactIdType?: 'phone' | 'platform' | 'title' | 'unknown';
  contactTitle?: string;
  contactRemark?: string;
  direction?: 'incoming' | 'outgoing' | 'unknown';
  timestamp?: string;
  messagePart?: 'body' | 'quote';
};

export type TranslationCacheLoadRequest = {
  profileId: string;
  platform?: Platform;
  profileName?: string;
  contactId?: string;
  contactIdType?: 'phone' | 'platform' | 'title' | 'unknown';
  contactTitle?: string;
  contactRemark?: string;
  offset?: number;
  limit?: number;
};

export type TranslationCacheLookupRequest = TranslationCacheLoadRequest & {
  sourceHashes: string[];
};

export type TranslationCacheSetRequest = {
  profileId: string;
  sourceHash: string;
  sourceText?: string;
  translatedText: string;
  platform?: Platform;
  profileName?: string;
  contactId?: string;
  contactIdType?: 'phone' | 'platform' | 'title' | 'unknown';
  contactTitle?: string;
  contactRemark?: string;
  direction?: 'incoming' | 'outgoing' | 'unknown';
  timestamp?: string;
  messagePart?: 'body' | 'quote';
};

export type NonEnglishContactRequest = {
  profileId: string;
  platform?: Platform;
  contactId?: string;
  contactIdType?: 'phone' | 'platform' | 'title' | 'unknown';
  contactTitle?: string;
  contactRemark?: string;
};

export type LockScreenStatus = {
  enabled: boolean;
  lockedUntil: number;
  failedAttempts: number;
  maxAttempts: number;
  requiresUpgrade: boolean;
};

export type NetworkOfflineCheckResult = {
  offline: boolean;
  checkedAt: number;
  reason?: string;
};

export type LockScreenPinChangeMode = 'setup' | 'reset' | 'upgrade';

export type LockScreenPinChangeAuthorizationResult = {
  ok: boolean;
  token?: string;
  expiresAt?: number;
  reason?: string;
  status: LockScreenStatus;
};

export type LockScreenSetPinResult = {
  ok: boolean;
  reason?: string;
  status: LockScreenStatus;
};

export type LockScreenUnlockResult = {
  ok: boolean;
  reason?: string;
  status: LockScreenStatus;
};

export type RemoteGuardState =
  | 'starting'
  | 'guarding'
  | 'suspicious'
  | 'alarm'
  | 'recovery'
  | 'degraded';

export type RemoteGuardFinding = {
  code: string;
  label: string;
  severity: 'suspicious' | 'confirmed';
  processName?: string;
};

export type RemoteGuardCoverage = {
  windowsSessions: boolean;
  processes: boolean;
  connections: 'available' | 'not-needed' | 'unavailable';
};

export type RemoteGuardStatus = {
  enabled: boolean;
  state: RemoteGuardState;
  checkedAt: number;
  nextScanAt: number;
  scanDurationMs: number;
  scanIntervalMs: number;
  processScanIntervalMs: number;
  windowsLockDelayMs: number;
  threatActive: boolean;
  incidentLatched: boolean;
  windowsSessionLocked: boolean;
  windowsLockState: 'idle' | 'scheduled' | 'requested' | 'confirmed' | 'failed';
  windowsLockScheduledAt?: number;
  windowsLockAttemptedAt?: number;
  findings: RemoteGuardFinding[];
  coverage: RemoteGuardCoverage;
  reason?: string;
};

export type RemoteGuardActionResult = {
  ok: boolean;
  status: RemoteGuardStatus;
  reason?: string;
};

export function sanitizeComposerEnglishTranslation(value: string) {
  return value
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[，、；：]/g, ',')
    .replace(/？/g, '?')
    .replace(/！/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/[。．]/g, '.')
    .replace(/；/g, ';')
    .replace(/—/g, '-')
    .replace(/…/g, '...')
    .replace(/[“”‘’]/g, '')
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/\s*,\s*/g, ', ')
        .replace(/,{2,}/g, ',')
        .replace(/[\t ]{2,}/g, ' ')
        .trim()
    )
    .join('\n')
    .trim();
}

export function restoreComposerEnglishLayout(
  source: string,
  translated: string
) {
  const sourceLines = source.replace(/\r\n?/g, '\n').split('\n');
  const translatedLines = translated
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(line => line.trim());
  const sourceTextLines = sourceLines.filter(line => line.trim());
  if (sourceTextLines.length !== translatedLines.length) return translated;
  let translatedIndex = 0;
  return sourceLines
    .map(sourceLine => {
      if (!sourceLine.trim()) return '';
      let line = translatedLines[translatedIndex++]?.trim() || '';
      if (/[？?]\s*$/.test(sourceLine)) {
        line = /\?+\s*$/.test(line)
          ? line.replace(/\?+\s*$/, '?')
          : `${line}?`;
      }
      return line;
    })
    .join('\n')
    .trim();
}

export function isTransientSignalScriptGateError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return (
    message.includes('Workspace is locked.') ||
    message.includes('Signal script execution is unavailable while locked') ||
    message.includes('Signal control channel is not connected')
  );
}

export type ClientAuthorizationState =
  | 'development'
  | 'needs-username'
  | 'needs-license'
  | 'authorized'
  | 'expired'
  | 'invalid'
  | 'device-error';

export type ClientAuthorizationStatus = {
  state: ClientAuthorizationState;
  authorized: boolean;
  runtimeAllowed: boolean;
  developmentMode: boolean;
  machineCode: string;
  username: string;
  usernameLocked: boolean;
  suiteId: string;
  keyId: string;
  expiresAt?: string;
  reason?: string;
};

export type ClientAuthorizationResult = {
  ok: boolean;
  status: ClientAuthorizationStatus;
  reason?: string;
  selfDestructRequired?: boolean;
};

export type ElectronApi = {
  getClientAuthorizationStatus: () => Promise<ClientAuthorizationStatus>;
  setClientUsername: (username: string) => Promise<ClientAuthorizationResult>;
  activateClientLicense: (licenseCode: string) => Promise<ClientAuthorizationResult>;
  replaceClientLicense: (licenseCode: string) => Promise<ClientAuthorizationResult>;
  copyClientMachineInfo: () => Promise<ClientAuthorizationResult>;
  getConfig: () => Promise<AppConfig>;
  isPackaged: () => Promise<boolean>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  getPlatformCatalog: () => Promise<PlatformInfo[]>;
  createProfile: (platform: Platform, name: string, group: string) => Promise<ChatProfile>;
  renameProfile: (id: string, name: string, group: string) => Promise<AppConfig>;
  removeProfile: (id: string) => Promise<AppConfig>;
  launchSignalProfile: (id: string) => Promise<{ pid: number | null; dataDir: string; wsPort?: number; recovered?: boolean }>;
  getSignalSourceOnlyAcceptance: () => Promise<boolean>;
  setSignalWorkspaceBounds: (id: string, bounds: SignalWorkspaceBounds) => Promise<void>;
  hideSignalProfile: (id: string) => Promise<void>;
  stopSignalProfile: (id: string) => Promise<void>;
  executeSignalScript: <T = unknown>(id: string, script: string) => Promise<T>;
  appendSignalDebugLog: (event: Record<string, unknown>) => Promise<void>;
  translate: (request: TranslateRequest) => Promise<string>;
  generateSmartReplies: (request: SmartReplyRequest) => Promise<SmartReplyResult>;
  authorizeTranslatedSend: (request: SendAuthorizationRequest) => Promise<SendAuthorizationResult>;
  prepareSensitiveSend: (request: SensitiveSendPrepareRequest) => Promise<SensitiveSendPrepareResult>;
  authorizeSensitiveSend: (request: SensitiveSendAuthorizeRequest) => Promise<SendAuthorizationResult>;
  loadTranslationCache: (request: TranslationCacheLoadRequest) => Promise<TranslationCacheEntry[]>;
  lookupTranslationCache: (request: TranslationCacheLookupRequest) => Promise<TranslationCacheEntry[]>;
  saveTranslationCacheEntry: (request: TranslationCacheSetRequest) => Promise<void>;
  markNonEnglishContact: (request: NonEnglishContactRequest) => Promise<void>;
  getMemoryStatus: () => Promise<MemoryStatus>;
  getLockScreenStatus: () => Promise<LockScreenStatus>;
  engageLockScreen: () => Promise<void>;
  checkNetworkOffline: () => Promise<NetworkOfflineCheckResult>;
  authorizeLockScreenPinChange: (mode: LockScreenPinChangeMode) => Promise<LockScreenPinChangeAuthorizationResult>;
  setLockScreenPin: (pin: string, token: string) => Promise<LockScreenSetPinResult>;
  unlockLockScreen: (pin: string) => Promise<LockScreenUnlockResult>;
  getRemoteGuardStatus: () => Promise<RemoteGuardStatus>;
  scanRemoteGuardNow: () => Promise<RemoteGuardStatus>;
  acknowledgeRemoteGuardIncident: () => Promise<RemoteGuardActionResult>;
  setWindowTheme: (theme: 'blackGold' | 'pink') => Promise<void>;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  onSignalActivateProfile: (handler: (profileId: string) => void) => () => void;
  onSignalWorkspaceSync: (handler: () => void) => () => void;
  onRemoteGuardStatus: (handler: (status: RemoteGuardStatus) => void) => () => void;
};

export type WindowControlApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};
