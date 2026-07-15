const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getClientAuthorizationStatus: () => ipcRenderer.invoke('client-license:status'),
  setClientUsername: (username) => ipcRenderer.invoke('client-license:set-username', username),
  activateClientLicense: (licenseCode) => ipcRenderer.invoke('client-license:activate', licenseCode),
  replaceClientLicense: (licenseCode) => ipcRenderer.invoke('client-license:replace', licenseCode),
  copyClientMachineInfo: () => ipcRenderer.invoke('client-license:copy-machine-info'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  isPackaged: () => ipcRenderer.invoke('app:is-packaged'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getPlatformCatalog: () => ipcRenderer.invoke('platforms:get'),
  createProfile: (platform, name, group) => ipcRenderer.invoke('profile:create', platform, name, group),
  renameProfile: (id, name, group) => ipcRenderer.invoke('profile:rename', id, name, group),
  removeProfile: (id) => ipcRenderer.invoke('profile:remove', id),
  launchSignalProfile: (id) => ipcRenderer.invoke('signal:launch', id),
  getSignalSourceOnlyAcceptance: () => ipcRenderer.invoke('signal:source-only-acceptance'),
  setSignalWorkspaceBounds: (id, bounds) => ipcRenderer.invoke('signal:set-workspace-bounds', id, bounds),
  hideSignalProfile: (id) => ipcRenderer.invoke('signal:hide', id),
  stopSignalProfile: (id) => ipcRenderer.invoke('signal:stop', id),
  executeSignalScript: (id, script) => ipcRenderer.invoke('signal:execute-script', id, script),
  appendSignalDebugLog: (event) => ipcRenderer.invoke('signal:debug-log', event),
  translate: (request) => ipcRenderer.invoke('translate', request),
  authorizeTranslatedSend: (request) => ipcRenderer.invoke('send-integrity:authorize', request),
  prepareSensitiveSend: (request) => ipcRenderer.invoke('send-integrity:prepare-sensitive', request),
  authorizeSensitiveSend: (request) => ipcRenderer.invoke('send-integrity:authorize-sensitive', request),
  loadTranslationCache: (request) => ipcRenderer.invoke('translation-cache:load', request),
  lookupTranslationCache: (request) => ipcRenderer.invoke('translation-cache:lookup', request),
  saveTranslationCacheEntry: (request) => ipcRenderer.invoke('translation-cache:save-entry', request),
  markNonEnglishContact: (request) => ipcRenderer.invoke('translation-cache:mark-non-english-contact', request),
  getMemoryStatus: () => ipcRenderer.invoke('system:get-memory-status'),
  getLockScreenStatus: () => ipcRenderer.invoke('lock-screen:status'),
  engageLockScreen: () => ipcRenderer.invoke('lock-screen:engage'),
  checkNetworkOffline: () => ipcRenderer.invoke('lock-screen:check-network-offline'),
  authorizeLockScreenPinChange: (mode) => ipcRenderer.invoke('lock-screen:authorize-pin-change', mode),
  setLockScreenPin: (pin, token) => ipcRenderer.invoke('lock-screen:set-pin', pin, token),
  unlockLockScreen: (pin) => ipcRenderer.invoke('lock-screen:unlock', pin),
  setWindowTheme: (theme) => ipcRenderer.invoke('window:set-theme', theme),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  onSignalActivateProfile: (handler) => {
    const listener = (_event, profileId) => handler(profileId);
    ipcRenderer.on('signal:activate-profile', listener);
    return () => ipcRenderer.removeListener('signal:activate-profile', listener);
  },
  onSignalWorkspaceSync: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('signal:sync-workspace', listener);
    return () => ipcRenderer.removeListener('signal:sync-workspace', listener);
  }
};

contextBridge.exposeInMainWorld('chatTranslator', api);

const windowControl = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close')
};

contextBridge.exposeInMainWorld('windowControl', windowControl);

window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      const button = target?.closest?.('[data-window-control]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      const button = target?.closest?.('[data-window-control]');
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
