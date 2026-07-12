import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  ChatProfile,
  ClientAuthorizationResult,
  ClientAuthorizationStatus,
  ElectronApi,
  Platform,
  SendAuthorizationRequest,
  SensitiveSendAuthorizeRequest,
  SensitiveSendPrepareRequest,
  SignalWorkspaceBounds,
  TranslateRequest,
  TranslationCacheLoadRequest,
  TranslationCacheLookupRequest,
  TranslationCacheSetRequest,
  NonEnglishContactRequest,
  WindowControlApi
} from './shared.js';

const api: ElectronApi = {
  getClientAuthorizationStatus: (): Promise<ClientAuthorizationStatus> => ipcRenderer.invoke('client-license:status'),
  setClientUsername: (username: string): Promise<ClientAuthorizationResult> => ipcRenderer.invoke('client-license:set-username', username),
  activateClientLicense: (licenseCode: string): Promise<ClientAuthorizationResult> => ipcRenderer.invoke('client-license:activate', licenseCode),
  copyClientMachineInfo: (): Promise<ClientAuthorizationResult> => ipcRenderer.invoke('client-license:copy-machine-info'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  isPackaged: () => ipcRenderer.invoke('app:is-packaged'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config),
  getPlatformCatalog: () => ipcRenderer.invoke('platforms:get'),
  createProfile: (platform: Platform, name: string, group: string) => ipcRenderer.invoke('profile:create', platform, name, group),
  renameProfile: (id: string, name: string, group: string) => ipcRenderer.invoke('profile:rename', id, name, group),
  removeProfile: (id: string) => ipcRenderer.invoke('profile:remove', id),
  launchSignalProfile: (id: string) => ipcRenderer.invoke('signal:launch', id),
  setSignalWorkspaceBounds: (id: string, bounds: SignalWorkspaceBounds) =>
    ipcRenderer.invoke('signal:set-workspace-bounds', id, bounds),
  hideSignalProfile: (id: string) => ipcRenderer.invoke('signal:hide', id),
  stopSignalProfile: (id: string) => ipcRenderer.invoke('signal:stop', id),
  executeSignalScript: (id: string, script: string) => ipcRenderer.invoke('signal:execute-script', id, script),
  appendSignalDebugLog: (event: Record<string, unknown>) => ipcRenderer.invoke('signal:debug-log', event),
  translate: (request: TranslateRequest) => ipcRenderer.invoke('translate', request),
  authorizeTranslatedSend: (request: SendAuthorizationRequest) => ipcRenderer.invoke('send-integrity:authorize', request),
  prepareSensitiveSend: (request: SensitiveSendPrepareRequest) => ipcRenderer.invoke('send-integrity:prepare-sensitive', request),
  authorizeSensitiveSend: (request: SensitiveSendAuthorizeRequest) => ipcRenderer.invoke('send-integrity:authorize-sensitive', request),
  loadTranslationCache: (request: TranslationCacheLoadRequest) => ipcRenderer.invoke('translation-cache:load', request),
  lookupTranslationCache: (request: TranslationCacheLookupRequest) => ipcRenderer.invoke('translation-cache:lookup', request),
  saveTranslationCacheEntry: (request: TranslationCacheSetRequest) => ipcRenderer.invoke('translation-cache:save-entry', request),
  markNonEnglishContact: (request: NonEnglishContactRequest) => ipcRenderer.invoke('translation-cache:mark-non-english-contact', request),
  getMemoryStatus: () => ipcRenderer.invoke('system:get-memory-status'),
  getLockScreenStatus: () => ipcRenderer.invoke('lock-screen:status'),
  setLockScreenPin: (pin: string) => ipcRenderer.invoke('lock-screen:set-pin', pin),
  unlockLockScreen: (pin: string) => ipcRenderer.invoke('lock-screen:unlock', pin),
  setWindowTheme: (theme: 'blackGold' | 'pink') => ipcRenderer.invoke('window:set-theme', theme),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text),
  onSignalActivateProfile: (handler: (profileId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, profileId: string) => handler(profileId);
    ipcRenderer.on('signal:activate-profile', listener);
    return () => ipcRenderer.removeListener('signal:activate-profile', listener);
  },
  onSignalWorkspaceSync: (handler: () => void) => {
    const listener = () => handler();
    ipcRenderer.on('signal:sync-workspace', listener);
    return () => ipcRenderer.removeListener('signal:sync-workspace', listener);
  }
};

contextBridge.exposeInMainWorld('chatTranslator', api);

const windowControl: WindowControlApi = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close')
};

contextBridge.exposeInMainWorld('windowControl', windowControl);

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>('[data-window-control]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>('[data-window-control]');
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();

      const action = button.dataset.windowControl;
      if (action === 'minimize' || action === 'toggle-maximize' || action === 'close') {
        ipcRenderer.send('window-control', action);
      }
    },
    true
  );
});

contextBridge.exposeInMainWorld('profileFingerprint', {
  apply(profile: ChatProfile) {
    const fp = profile.fingerprint;
    if (fp.languageSource === 'custom' && fp.languages.length > 0) {
      Object.defineProperty(navigator, 'languages', { get: () => fp.languages });
      Object.defineProperty(navigator, 'language', { get: () => fp.languages[0] });
    }

    if (fp.hardwareSource === 'custom') {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardwareConcurrency });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => fp.deviceMemory });
    }

    if (fp.timezoneSource === 'custom' && fp.timezone) {
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
        return { ...originalResolvedOptions.call(this), timeZone: fp.timezone };
      };
    }

    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function getParameter(parameter: number) {
      if (parameter === 37445) return fp.webglVendor;
      if (parameter === 37446) return fp.webglRenderer;
      return originalGetParameter.call(this, parameter);
    };

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function toDataURL(...args: Parameters<HTMLCanvasElement['toDataURL']>) {
      const context = this.getContext('2d');
      if (context) {
        const x = fp.canvasSeed % Math.max(1, this.width || 1);
        const y = fp.canvasSeed % Math.max(1, this.height || 1);
        context.fillStyle = `rgba(${fp.canvasSeed % 255}, 1, 1, 0.01)`;
        context.fillRect(x, y, 1, 1);
      }
      return originalToDataURL.apply(this, args);
    };
  }
});
