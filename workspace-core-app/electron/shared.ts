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
  platform: Platform;
  partition: string;
  signalDataDir?: string;
  createdAt: number;
  fingerprint: FingerprintProfile;
};

export type AppConfig = {
  profiles: ChatProfile[];
  activeProfileId: string | null;
  deepseekApiKey: string;
  deepseekModel: string;
};

export type TranslateRequest = {
  text: string;
  from?: string;
  to: string;
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

export type ElectronApi = {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  getPlatformCatalog: () => Promise<PlatformInfo[]>;
  createProfile: (platform: Platform, name?: string) => Promise<ChatProfile>;
  renameProfile: (id: string, name: string) => Promise<AppConfig>;
  removeProfile: (id: string) => Promise<AppConfig>;
  translate: (request: TranslateRequest) => Promise<string>;
  loadTranslationCache: (request: TranslationCacheLoadRequest) => Promise<TranslationCacheEntry[]>;
  saveTranslationCacheEntry: (request: TranslationCacheSetRequest) => Promise<void>;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
};

export type WindowControlApi = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
};
