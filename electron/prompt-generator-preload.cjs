const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptGenerator', Object.freeze({
  getDefaults: () => ipcRenderer.invoke('prompt-generator:defaults'),
  generate: input => ipcRenderer.invoke('prompt-generator:generate', input),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
}));
