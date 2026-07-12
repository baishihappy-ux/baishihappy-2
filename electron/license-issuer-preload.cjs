const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getStatus: () => ipcRenderer.invoke('issuer:status'),
  initializePassword: (password) => ipcRenderer.invoke('issuer:initialize-password', password),
  login: (password) => ipcRenderer.invoke('issuer:login', password),
  issueLicense: (input) => ipcRenderer.invoke('issuer:issue-license', input),
  copyText: (text) => ipcRenderer.invoke('issuer:copy-text', text),
  saveLicenseDat: (licenseCode) => ipcRenderer.invoke('issuer:save-license-dat', licenseCode),
  getSuiteSummary: () => ipcRenderer.invoke('issuer:suite-summary'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close')
};

contextBridge.exposeInMainWorld('licenseIssuer', api);
