export type Platform = 'whatsapp' | 'telegram-a' | 'telegram-k' | 'signal';

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
  deepseekModel: string;
};

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
  copyClientMachineInfo: () => Promise<ClientAuthorizationResult>;
  getConfig: () => Promise<AppConfig>;
  isPackaged: () => Promise<boolean>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  getPlatformCatalog: () => Promise<PlatformInfo[]>;
  createProfile: (platform: Platform, name: string, group: string) => Promise<ChatProfile>;
  renameProfile: (id: string, name: string, group: string) => Promise<AppConfig>;
  removeProfile: (id: string) => Promise<AppConfig>;
  launchSignalProfile: (id: string) => Promise<{ pid: number | null; dataDir: string; wsPort?: number; recovered?: boolean }>;
  setSignalWorkspaceBounds: (id: string, bounds: SignalWorkspaceBounds) => Promise<void>;
  hideSignalProfile: (id: string) => Promise<void>;
  stopSignalProfile: (id: string) => Promise<void>;
  executeSignalScript: <T = unknown>(id: string, script: string) => Promise<T>;
  appendSignalDebugLog: (event: Record<string, unknown>) => Promise<void>;
  translate: (request: TranslateRequest) => Promise<string>;
  authorizeTranslatedSend: (request: SendAuthorizationRequest) => Promise<SendAuthorizationResult>;
  prepareSensitiveSend: (request: SensitiveSendPrepareRequest) => Promise<SensitiveSendPrepareResult>;
  authorizeSensitiveSend: (request: SensitiveSendAuthorizeRequest) => Promise<SendAuthorizationResult>;
  loadTranslationCache: (request: TranslationCacheLoadRequest) => Promise<TranslationCacheEntry[]>;
  lookupTranslationCache: (request: TranslationCacheLookupRequest) => Promise<TranslationCacheEntry[]>;
  saveTranslationCacheEntry: (request: TranslationCacheSetRequest) => Promise<void>;
  markNonEnglishContact: (request: NonEnglishContactRequest) => Promise<void>;
  getMemoryStatus: () => Promise<MemoryStatus>;
  getLockScreenStatus: () => Promise<LockScreenStatus>;
  setLockScreenPin: (pin: string) => Promise<LockScreenSetPinResult>;
  unlockLockScreen: (pin: string) => Promise<LockScreenUnlockResult>;
  setWindowTheme: (theme: 'blackGold' | 'pink') => Promise<void>;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  onSignalActivateProfile: (handler: (profileId: string) => void) => () => void;
  onSignalWorkspaceSync: (handler: () => void) => () => void;
};

export type WindowControlApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};
