import { contextBridge, ipcRenderer } from 'electron';

export type IssuerStatus = {
  initialized: boolean;
  lockedUntil?: number;
  lockLevel?: number;
  attemptsRemaining?: number;
  message?: string;
};

export type IssueLicenseInput = {
  machineCode: string;
  username: string;
  serviceSecret: string;
  authorizedDays: number;
};

export type IssueLicenseOutput = {
  licenseCode: string;
  licenseId?: string;
  effectiveAt?: string;
  expiresAt?: string;
  suiteId: string;
  keyId: string;
};

const api = {
  getStatus: (): Promise<IssuerStatus> => ipcRenderer.invoke('issuer:status'),
  initializePassword: (password: string): Promise<IssuerStatus> => ipcRenderer.invoke('issuer:initialize-password', password),
  login: (password: string): Promise<IssuerStatus & { authenticated: boolean }> => ipcRenderer.invoke('issuer:login', password),
  issueLicense: (input: IssueLicenseInput): Promise<IssueLicenseOutput> => ipcRenderer.invoke('issuer:issue-license', input),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('issuer:copy-text', text),
  saveLicenseDat: (licenseCode: string): Promise<{ path?: string; canceled?: boolean }> => ipcRenderer.invoke('issuer:save-license-dat', licenseCode),
  getSuiteSummary: (): Promise<{ suiteId: string; keyId: string; publicKeySha256: string }> => ipcRenderer.invoke('issuer:suite-summary'),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  close: (): Promise<void> => ipcRenderer.invoke('window:close')
};

contextBridge.exposeInMainWorld('licenseIssuer', api);
