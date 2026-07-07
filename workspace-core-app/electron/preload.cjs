const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getPlatformCatalog: () => ipcRenderer.invoke('platforms:get'),
  createProfile: (platform, name) => ipcRenderer.invoke('profile:create', platform, name),
  renameProfile: (id, name) => ipcRenderer.invoke('profile:rename', id, name),
  removeProfile: (id) => ipcRenderer.invoke('profile:remove', id),
  translate: (request) => ipcRenderer.invoke('translate', request),
  loadTranslationCache: (request) => ipcRenderer.invoke('translation-cache:load', request),
  saveTranslationCacheEntry: (request) => ipcRenderer.invoke('translation-cache:save-entry', request),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:write-text', text)
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
