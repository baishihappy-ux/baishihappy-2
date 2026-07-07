import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  ChatProfile,
  ElectronApi,
  Platform,
  TranslateRequest,
  TranslationCacheLoadRequest,
  TranslationCacheSetRequest,
  WindowControlApi
} from './shared.js';

const api: ElectronApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('config:save', config),
  getPlatformCatalog: () => ipcRenderer.invoke('platforms:get'),
  createProfile: (platform: Platform, name?: string) => ipcRenderer.invoke('profile:create', platform, name),
  renameProfile: (id: string, name: string) => ipcRenderer.invoke('profile:rename', id, name),
  removeProfile: (id: string) => ipcRenderer.invoke('profile:remove', id),
  translate: (request: TranslateRequest) => ipcRenderer.invoke('translate', request),
  loadTranslationCache: (request: TranslationCacheLoadRequest) => ipcRenderer.invoke('translation-cache:load', request),
  saveTranslationCacheEntry: (request: TranslationCacheSetRequest) => ipcRenderer.invoke('translation-cache:save-entry', request),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text: string) => ipcRenderer.invoke('clipboard:write-text', text)
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
