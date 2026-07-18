import { execFile } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import {
  evaluateRemoteGuardScan,
  type RemoteGuardScanEvaluation
} from './remote-guard-core.js';

type CommandResult = {
  ok: boolean;
  stdout: string;
};

export const remoteGuardProcessScanIntervalMs = 5 * 60 * 1000;
const fastCommandTimeoutMs = 900;
const processCommandTimeoutMs = 1_200;
const commandMaxBuffer = 4 * 1024 * 1024;
let lastProcessScanAttemptAt = 0;
let cachedTasklist: CommandResult = { ok: false, stdout: '' };

function trustedWindowsRoot() {
  const root = resolve(process.env.SystemRoot || process.env.windir || 'C:\\Windows');
  if (!isAbsolute(root) || !/^[A-Za-z]:\\Windows$/i.test(root)) {
    throw new Error('Windows system directory is invalid.');
  }
  return root;
}

function windowsSystemExecutable(name: string) {
  if (!/^[A-Za-z0-9.-]+\.exe$/i.test(name)) throw new Error('Windows executable name is invalid.');
  return join(trustedWindowsRoot(), 'System32', name);
}

function runWindowsCommand(executable: string, args: string[], timeoutMs = fastCommandTimeoutMs) {
  return new Promise<CommandResult>((resolveResult) => {
    execFile(
      executable,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: commandMaxBuffer,
        encoding: 'utf8',
        shell: false
      },
      (error, stdout) => {
        resolveResult({
          ok: !error,
          stdout: typeof stdout === 'string' ? stdout : ''
        });
      }
    );
  });
}

export async function inspectWindowsRemoteAccess(
  currentProcessId: number,
  options: { forceProcessRefresh?: boolean } = {}
): Promise<RemoteGuardScanEvaluation> {
  if (process.platform !== 'win32') {
    return {
      state: 'degraded',
      threatActive: false,
      findings: [],
      coverage: { windowsSessions: false, processes: false, connections: 'unavailable' },
      reason: '御前侍卫仅支持 Windows'
    };
  }

  let sessions: CommandResult = { ok: false, stdout: '' };
  let netstat: CommandResult = { ok: false, stdout: '' };
  const now = Date.now();
  const refreshProcesses = options.forceProcessRefresh === true || now - lastProcessScanAttemptAt >= remoteGuardProcessScanIntervalMs;
  try {
    const processScan = refreshProcesses
      ? runWindowsCommand(windowsSystemExecutable('tasklist.exe'), ['/FO', 'CSV', '/NH'], processCommandTimeoutMs)
      : Promise.resolve(cachedTasklist);
    if (refreshProcesses) lastProcessScanAttemptAt = now;
    const [processResult, sessionResult, connectionResult] = await Promise.all([
      processScan,
      runWindowsCommand(windowsSystemExecutable('qwinsta.exe'), []),
      runWindowsCommand(windowsSystemExecutable('netstat.exe'), ['-ano', '-p', 'tcp'])
    ]);
    if (refreshProcesses) cachedTasklist = processResult.ok ? processResult : { ok: false, stdout: '' };
    sessions = sessionResult;
    netstat = connectionResult;
  } catch {
    // Invalid or unavailable Windows system paths fail visibly through degraded coverage.
  }

  return evaluateRemoteGuardScan({
    currentProcessId,
    tasklistOutput: cachedTasklist.stdout,
    qwinstaOutput: sessions.stdout,
    netstatOutput: netstat.stdout,
    processesAvailable: cachedTasklist.ok,
    windowsSessionsAvailable: sessions.ok,
    connections: netstat.ok ? 'available' : 'unavailable'
  });
}

export async function requestWindowsWorkstationLock() {
  if (process.platform !== 'win32') return false;
  try {
    const systemRoot = trustedWindowsRoot();
    const result = await runWindowsCommand(
      windowsSystemExecutable('rundll32.exe'),
      [`${join(systemRoot, 'System32', 'user32.dll')},LockWorkStation`],
      3_000
    );
    return result.ok;
  } catch {
    return false;
  }
}
