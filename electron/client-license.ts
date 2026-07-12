import { app, safeStorage } from 'electron';
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, hostname, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  ClientAuthorizationResult,
  ClientAuthorizationState,
  ClientAuthorizationStatus
} from './shared.js';
import {
  createMachineCode,
  licenseSuiteProductId,
  sha256Hex,
  verifyLicenseCode,
  type LicensePayload,
  type LicenseSuitePrivateConfig,
  type LicenseSuitePublicConfig
} from './license-core.js';

type DeviceIdentityFile = {
  schemaVersion: 2;
  productId: string;
  publicKeyPem: string;
  protectedPrivateKey: string;
  encryptionPublicKeyPem: string;
  protectedEncryptionPrivateKey: string;
  protectedDeviceSecret: string;
  protectedUsername?: string;
  createdAt: string;
};

type AuthorizationGuardState = {
  schemaVersion: 1;
  productId: string;
  suiteId: string;
  hardwareHash: string;
  failedAttempts: number;
  lockedAt?: string;
};

type ClientAccountFile = {
  schemaVersion: 1;
  username: string;
  createdAt: string;
};

type LoadedDeviceIdentity = {
  file: DeviceIdentityFile;
  privateKeyPem: string;
  encryptionPrivateKeyPem: string;
  deviceSecret: Buffer;
};

const usernameMaxLength = 64;

function publicSuiteFromConfig(config: LicenseSuitePublicConfig | LicenseSuitePrivateConfig): LicenseSuitePublicConfig {
  return {
    suiteId: config.suiteId,
    issuerId: config.issuerId,
    productId: config.productId,
    keyId: config.keyId,
    publicKeyPem: config.publicKeyPem
  };
}

async function writeFileAtomic(path: string, value: string | Buffer) {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tempPath, value);
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(path, { force: true });
    await rename(tempPath, path);
    void error;
  }
}

function runFile(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout || '');
    });
  });
}

async function windowsMachineGuid() {
  if (process.platform !== 'win32') return '';
  try {
    const output = await runFile('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid'
    ]);
    return output.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

async function hardwareDigest() {
  const stableGuid = await windowsMachineGuid();
  const fallback = [hostname(), platform(), arch(), cpus()[0]?.model || 'unknown-cpu'].join('\0');
  return sha256Hex(stableGuid || fallback);
}

function normalizeUsername(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

function assertUsername(value: string) {
  const username = normalizeUsername(value);
  if (!username) throw new Error('用户名不能为空');
  if (username.length > usernameMaxLength) throw new Error(`用户名不能超过 ${usernameMaxLength} 个字符`);
  return username;
}

export class ClientLicenseManager {
  private suite: LicenseSuitePublicConfig | null = null;
  private identity: LoadedDeviceIdentity | null = null;
  private account: ClientAccountFile | null = null;
  private machineCode = '';
  private hardwareHash = '';
  private deviceError = '';
  private licenseReason = '';
  private verifiedPayload: LicensePayload | null = null;
  private initialized = false;
  private identityCreatedThisRun = false;
  private authorizationGuard: AuthorizationGuardState | null = null;
  private readonly developmentMode = !app.isPackaged && process.env.MAOYI_REQUIRE_LICENSE_IN_DEV !== '1';

  private identityPath() {
    return join(app.getPath('userData'), 'device-identity.dat');
  }

  private accountPath() {
    return join(app.getPath('userData'), 'client-account.json');
  }

  private licensePath() {
    return join(app.getPath('userData'), 'license.dat');
  }

  private authorizationGuardPath() {
    const suiteId = this.suite?.suiteId || 'unknown-suite';
    return join(app.getPath('appData'), 'maoyi Security', suiteId, 'authorization-guard.dat');
  }

  private async readAuthorizationGuard() {
    try {
      const encrypted = await readFile(this.authorizationGuardPath());
      const state = JSON.parse(safeStorage.decryptString(encrypted)) as AuthorizationGuardState;
      if (
        state.schemaVersion !== 1 ||
        state.productId !== licenseSuiteProductId ||
        state.suiteId !== this.suite?.suiteId ||
        state.hardwareHash !== this.hardwareHash
      ) throw new Error('授权安全状态校验失败');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writeAuthorizationGuard(state: AuthorizationGuardState) {
    const target = this.authorizationGuardPath();
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, safeStorage.encryptString(JSON.stringify(state)));
    this.authorizationGuard = state;
  }

  private async recordAuthorizationFailure() {
    const failedAttempts = Math.min(5, (this.authorizationGuard?.failedAttempts || 0) + 1);
    const state: AuthorizationGuardState = {
      schemaVersion: 1,
      productId: licenseSuiteProductId,
      suiteId: this.suite?.suiteId || '',
      hardwareHash: this.hardwareHash,
      failedAttempts,
      lockedAt: failedAttempts >= 5 ? new Date().toISOString() : undefined
    };
    await this.writeAuthorizationGuard(state);
    if (state.lockedAt) this.deviceError = '授权错误次数已达上限，此电脑已永久锁死';
    return state;
  }

  private suitePath() {
    const override = process.env.MAOYI_LICENSE_PUBLIC_SUITE_PATH?.trim();
    if (override) return override;
    if (!app.isPackaged) return join(process.cwd(), '.package-secrets', 'current-license-suite.json');
    return join(process.resourcesPath, 'license-suite-public.json');
  }

  async initialize() {
    if (this.initialized) return this.getStatus();
    this.initialized = true;
    try {
      this.suite = publicSuiteFromConfig(JSON.parse(await readFile(this.suitePath(), 'utf8')) as LicenseSuitePublicConfig);
      if (!this.suite.suiteId || !this.suite.keyId || !this.suite.publicKeyPem || this.suite.productId !== licenseSuiteProductId) {
        throw new Error('客户端授权套装配置不完整');
      }
      this.identity = await this.loadOrCreateIdentity();
      this.hardwareHash = await hardwareDigest();
      this.machineCode = createMachineCode({
        suiteId: this.suite.suiteId,
        hardwareHash: this.hardwareHash,
        encryptionPublicKeyPem: this.identity.file.encryptionPublicKeyPem
      });
      this.account = await this.readAccount();
      this.authorizationGuard = await this.readAuthorizationGuard();
      if (this.authorizationGuard?.lockedAt) {
        this.deviceError = '授权错误次数已达上限，此电脑已永久锁死';
        return this.getStatus();
      }
      if (this.account?.username && !this.identity.file.protectedUsername) {
        await this.bindUsernameToIdentity(this.account.username);
      }
      await this.verifyPersistedLicense();
    } catch (error) {
      this.deviceError = error instanceof Error ? error.message : '设备身份初始化失败';
    }
    return this.getStatus();
  }

  private async loadOrCreateIdentity(): Promise<LoadedDeviceIdentity> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows DPAPI 当前不可用，无法建立设备身份');
    }
    let existingRaw = '';
    try {
      existingRaw = await readFile(this.identityPath(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as Partial<DeviceIdentityFile> & {
        schemaVersion?: number;
        publicKeyPem?: string;
        protectedPrivateKey?: string;
        protectedDeviceSecret?: string;
      };
      if (![1, 2].includes(existing.schemaVersion || 0) || existing.productId !== licenseSuiteProductId || !existing.publicKeyPem || !existing.protectedPrivateKey || !existing.protectedDeviceSecret) {
        throw new Error('设备身份文件格式无效');
      }
      const privateKeyPem = safeStorage.decryptString(Buffer.from(existing.protectedPrivateKey, 'base64'));
      const deviceSecret = Buffer.from(safeStorage.decryptString(Buffer.from(existing.protectedDeviceSecret, 'base64')), 'base64');
      const derivedPublicKey = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
      if (sha256Hex(derivedPublicKey) !== sha256Hex(existing.publicKeyPem) || deviceSecret.length !== 32) {
        throw new Error('设备身份校验失败');
      }
      let encryptionPublicKeyPem = existing.encryptionPublicKeyPem || '';
      let encryptionPrivateKeyPem = '';
      if (existing.schemaVersion === 2 && encryptionPublicKeyPem && existing.protectedEncryptionPrivateKey) {
        encryptionPrivateKeyPem = safeStorage.decryptString(Buffer.from(existing.protectedEncryptionPrivateKey, 'base64'));
        const derivedEncryptionPublicKey = createPublicKey(encryptionPrivateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
        if (sha256Hex(derivedEncryptionPublicKey) !== sha256Hex(encryptionPublicKeyPem)) throw new Error('设备加密身份校验失败');
      } else {
        const encryptionKeys = generateKeyPairSync('x25519');
        encryptionPublicKeyPem = encryptionKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
        encryptionPrivateKeyPem = encryptionKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      }
      const file: DeviceIdentityFile = {
        schemaVersion: 2,
        productId: licenseSuiteProductId,
        publicKeyPem: existing.publicKeyPem,
        protectedPrivateKey: existing.protectedPrivateKey,
        encryptionPublicKeyPem,
        protectedEncryptionPrivateKey: existing.protectedEncryptionPrivateKey || safeStorage.encryptString(encryptionPrivateKeyPem).toString('base64'),
        protectedDeviceSecret: existing.protectedDeviceSecret,
        protectedUsername: existing.protectedUsername,
        createdAt: existing.createdAt || new Date().toISOString()
      };
      if (existing.schemaVersion !== 2 || !existing.encryptionPublicKeyPem || !existing.protectedEncryptionPrivateKey) {
        await writeFileAtomic(this.identityPath(), `${JSON.stringify(file, null, 2)}\n`);
      }
      return { file, privateKeyPem, encryptionPrivateKeyPem, deviceSecret };
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const encryptionKeys = generateKeyPairSync('x25519');
    this.identityCreatedThisRun = true;
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const encryptionPublicKeyPem = encryptionKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const encryptionPrivateKeyPem = encryptionKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const deviceSecret = randomBytes(32);
    const file: DeviceIdentityFile = {
      schemaVersion: 2,
      productId: licenseSuiteProductId,
      publicKeyPem,
      protectedPrivateKey: safeStorage.encryptString(privateKeyPem).toString('base64'),
      encryptionPublicKeyPem,
      protectedEncryptionPrivateKey: safeStorage.encryptString(encryptionPrivateKeyPem).toString('base64'),
      protectedDeviceSecret: safeStorage.encryptString(deviceSecret.toString('base64')).toString('base64'),
      createdAt: new Date().toISOString()
    };
    await writeFileAtomic(this.identityPath(), `${JSON.stringify(file, null, 2)}\n`);
    return { file, privateKeyPem, encryptionPrivateKeyPem, deviceSecret };
  }

  private async readAccount() {
    const boundUsername = this.identity?.file.protectedUsername
      ? assertUsername(safeStorage.decryptString(Buffer.from(this.identity.file.protectedUsername, 'base64')))
      : '';
    let raw = '';
    try {
      raw = await readFile(this.accountPath(), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return boundUsername
          ? { schemaVersion: 1, username: boundUsername, createdAt: this.identity?.file.createdAt || new Date().toISOString() } satisfies ClientAccountFile
          : null;
      }
      throw error;
    }
    const account = JSON.parse(raw) as ClientAccountFile;
    if (account.schemaVersion !== 1) throw new Error('客户端用户名文件格式无效');
    const username = assertUsername(account.username || '');
    if (boundUsername && boundUsername !== username) throw new Error('客户端用户名与设备绑定不一致');
    return { schemaVersion: 1, username, createdAt: account.createdAt || new Date().toISOString() } satisfies ClientAccountFile;
  }

  private async bindUsernameToIdentity(username: string) {
    if (!this.identity) throw new Error('设备身份尚未初始化');
    const existing = this.identity.file.protectedUsername
      ? safeStorage.decryptString(Buffer.from(this.identity.file.protectedUsername, 'base64'))
      : '';
    if (existing && existing !== username) throw new Error('用户名仅支持设置一次，设置后无法更改');
    if (existing) return;
    this.identity.file.protectedUsername = safeStorage.encryptString(username).toString('base64');
    await writeFileAtomic(this.identityPath(), `${JSON.stringify(this.identity.file, null, 2)}\n`);
  }

  private async verifyPersistedLicense() {
    this.verifiedPayload = null;
    this.licenseReason = '';
    if (!this.suite || !this.machineCode || !this.account?.username || !this.identity) return;
    try {
      const code = (await readFile(this.licensePath(), 'utf8')).trim();
      const result = verifyLicenseCode({
        code,
        suite: this.suite,
        machineCode: this.machineCode,
        username: this.account.username,
        deviceEncryptionPrivateKeyPem: this.identity.encryptionPrivateKeyPem
      });
      if (result.ok && result.payload) {
        this.verifiedPayload = result.payload;
      } else {
        this.licenseReason = result.reason || '授权校验失败';
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        this.licenseReason = error instanceof Error ? error.message : '授权文件读取失败';
      }
    }
  }

  private currentState(): ClientAuthorizationState {
    if (this.deviceError) return 'device-error';
    if (this.developmentMode) return 'development';
    if (!this.account?.username) return 'needs-username';
    if (this.verifiedPayload && Date.now() <= Date.parse(this.verifiedPayload.expiresAt)) return 'authorized';
    if (/过期/.test(this.licenseReason)) return 'expired';
    if (this.licenseReason) return 'invalid';
    return 'needs-license';
  }

  getStatus(): ClientAuthorizationStatus {
    const state = this.currentState();
    const authorized = state === 'authorized';
    return {
      state,
      authorized,
      runtimeAllowed: authorized || state === 'development',
      developmentMode: state === 'development',
      machineCode: this.machineCode,
      username: this.account?.username || '',
      usernameLocked: Boolean(this.account?.username),
      suiteId: this.suite?.suiteId || '',
      keyId: this.suite?.keyId || '',
      expiresAt: this.verifiedPayload?.expiresAt,
      reason: this.deviceError || this.licenseReason || undefined
    };
  }

  getRuntimeSecurityExpectation() {
    return {
      suiteId: this.suite?.suiteId || '',
      keyId: this.suite?.keyId || '',
      machineCodeHash: this.machineCode ? sha256Hex(this.machineCode) : '',
      hardwareHash: this.hardwareHash,
      devicePublicKeyPem: this.identity?.file.publicKeyPem || ''
    };
  }

  wasDeviceIdentityCreatedThisRun() {
    return this.identityCreatedThisRun;
  }

  getRuntimeSecurityMaterial() {
    this.assertRuntimeAllowed();
    const material = this.getRuntimeSecurityExpectation();
    if (
      !material.suiteId ||
      !material.keyId ||
      !material.machineCodeHash ||
      !material.hardwareHash ||
      !material.devicePublicKeyPem ||
      !this.identity
    ) {
      throw new Error('客户端设备身份尚未建立，无法创建运行时绑定');
    }
    return {
      ...material,
      devicePrivateKeyPem: this.identity.privateKeyPem
    };
  }

  isRuntimeAllowed() {
    const status = this.getStatus();
    return status.runtimeAllowed && (status.developmentMode || !status.expiresAt || Date.now() <= Date.parse(status.expiresAt));
  }

  assertRuntimeAllowed() {
    if (!this.isRuntimeAllowed()) throw new Error('客户端尚未通过本机授权');
  }

  getServiceSecret() {
    if (!this.isRuntimeAllowed() || this.developmentMode) return '';
    return this.verifiedPayload?.serviceSecret || '';
  }

  async setUsername(value: string): Promise<ClientAuthorizationResult> {
    await this.initialize();
    if (this.deviceError) return { ok: false, reason: this.deviceError, status: this.getStatus() };
    const username = assertUsername(value);
    if (this.account?.username && this.account.username !== username) {
      return { ok: false, reason: '用户名仅支持设置一次，设置后无法更改', status: this.getStatus() };
    }
    if (!this.account) {
      const account = { schemaVersion: 1, username, createdAt: new Date().toISOString() } satisfies ClientAccountFile;
      await this.bindUsernameToIdentity(username);
      await writeFileAtomic(this.accountPath(), `${JSON.stringify(account, null, 2)}\n`);
      this.account = account;
    }
    await this.verifyPersistedLicense();
    return { ok: true, status: this.getStatus() };
  }

  async activate(licenseCode: string): Promise<ClientAuthorizationResult> {
    await this.initialize();
    if (!this.suite || !this.machineCode || !this.account?.username) {
      return { ok: false, reason: '请先设置用户名', status: this.getStatus() };
    }
    const code = licenseCode.trim();
    if (!code) return { ok: false, reason: '请输入授权码', status: this.getStatus() };
    const result = verifyLicenseCode({
      code,
      suite: this.suite,
      machineCode: this.machineCode,
      username: this.account.username,
      deviceEncryptionPrivateKeyPem: this.identity?.encryptionPrivateKeyPem || ''
    });
    if (!result.ok || !result.payload) {
      this.verifiedPayload = null;
      this.licenseReason = result.reason || '授权码校验失败';
      const guard = await this.recordAuthorizationFailure();
      const remaining = Math.max(0, 5 - guard.failedAttempts);
      const reason = guard.lockedAt ? this.deviceError : `${this.licenseReason}，剩余 ${remaining} 次机会`;
      return { ok: false, reason, status: this.getStatus(), selfDestructRequired: Boolean(guard.lockedAt) };
    }
    await writeFileAtomic(this.licensePath(), `${code}\n`);
    this.verifiedPayload = result.payload;
    this.licenseReason = '';
    this.authorizationGuard = null;
    await rm(this.authorizationGuardPath(), { force: true });
    return { ok: true, status: this.getStatus() };
  }

  machineInfoText() {
    if (!this.account?.username) throw new Error('请先设置用户名');
    return `本机码：${this.machineCode}\n用户名：${this.account.username}`;
  }
}
