import type {
  RemoteGuardCoverage,
  RemoteGuardFinding,
  RemoteGuardState
} from './shared.js';

export type WindowsProcessRow = {
  imageName: string;
  processId: number;
  sessionName: string;
  sessionId: number | null;
};

export type WindowsSessionRow = {
  sessionName: string;
  current: boolean;
  active: boolean;
};

export type RemoteGuardScanInput = {
  currentProcessId: number;
  tasklistOutput?: string;
  qwinstaOutput?: string;
  netstatOutput?: string;
  processesAvailable: boolean;
  windowsSessionsAvailable: boolean;
  connections: RemoteGuardCoverage['connections'];
};

export type RemoteGuardScanEvaluation = {
  state: RemoteGuardState;
  threatActive: boolean;
  findings: RemoteGuardFinding[];
  coverage: RemoteGuardCoverage;
  reason?: string;
};

const remoteHostProcesses: Readonly<Record<string, string>> = Object.freeze({
  'anydesk.exe': 'AnyDesk 远控程序正在运行',
  'teamviewer.exe': 'TeamViewer 远控程序正在运行',
  'teamviewer_service.exe': 'TeamViewer 远控服务正在运行',
  'teamviewer_desktop.exe': 'TeamViewer 桌面控制组件正在运行',
  'rustdesk.exe': 'RustDesk 远控程序正在运行',
  'todesk.exe': 'ToDesk 远控程序正在运行',
  'todesk_service.exe': 'ToDesk 远控服务正在运行',
  'todesk_daemon.exe': 'ToDesk 远控服务正在运行',
  'sunloginclient.exe': '向日葵远控客户端正在运行',
  'sunloginremote.exe': '向日葵远控组件正在运行',
  'quickassist.exe': 'Windows 快速助手正在运行',
  'msra.exe': 'Windows 远程协助正在运行',
  'remoting_host.exe': 'Chrome 远程桌面主机正在运行',
  'screenconnect.clientservice.exe': 'ScreenConnect 远控服务正在运行',
  'screenconnect.windowsclient.exe': 'ScreenConnect 远控客户端正在运行',
  'splashtopremoteservice.exe': 'Splashtop 远控服务正在运行',
  'splashtopremote.exe': 'Splashtop 远控程序正在运行',
  'supremo.exe': 'Supremo 远控程序正在运行',
  'dwagent.exe': 'DWService 远控服务正在运行',
  'meshagent.exe': 'MeshCentral 远控服务正在运行',
  'parsecd.exe': 'Parsec 远控服务正在运行',
  'winvnc.exe': 'VNC 远控服务正在运行',
  'tvnserver.exe': 'TightVNC 远控服务正在运行',
  'uvnc_service.exe': 'UltraVNC 远控服务正在运行',
  'tightvncserver.exe': 'TightVNC 远控服务正在运行'
});

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      values.push(value);
      value = '';
      continue;
    }
    value += character;
  }
  values.push(value);
  return values;
}

export function parseWindowsTasklist(output: string): WindowsProcessRow[] {
  const rows: WindowsProcessRow[] = [];
  for (const line of output.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || /^INFO:/i.test(line.trim())) continue;
    const values = parseCsvLine(line);
    if (values.length < 4) continue;
    const processId = Number.parseInt(values[1], 10);
    if (!Number.isSafeInteger(processId) || processId <= 0) continue;
    const sessionId = Number.parseInt(values[3], 10);
    rows.push({
      imageName: values[0].trim(),
      processId,
      sessionName: values[2].trim(),
      sessionId: Number.isSafeInteger(sessionId) && sessionId >= 0 ? sessionId : null
    });
  }
  return rows;
}

export function parseWindowsSessions(output: string): WindowsSessionRow[] {
  const rows: WindowsSessionRow[] = [];
  for (const rawLine of output.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!rawLine.trim() || /SESSIONNAME/i.test(rawLine)) continue;
    const current = /^\s*>/.test(rawLine);
    const line = rawLine.replace(/^\s*>?\s*/, '');
    const sessionName = line.split(/\s+/)[0]?.trim() || '';
    if (!sessionName) continue;
    const disconnected = /\s(?:disc|down|listen|idle|断开|侦听|空闲)\s/i.test(` ${line} `);
    const explicitActive = /\s(?:active|运行中)\s/i.test(` ${line} `);
    rows.push({
      sessionName,
      current,
      active: current || (explicitActive && !disconnected)
    });
  }
  return rows;
}

function portFromEndpoint(endpoint: string) {
  const match = endpoint.match(/:(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function parseEstablishedTcpConnections(output: string) {
  const connections: Array<{ localPort: number | null; remotePort: number | null; processId: number }> = [];
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0]?.toUpperCase() !== 'TCP') continue;
    const state = columns[3]?.toUpperCase();
    const processId = Number.parseInt(columns[4], 10);
    if (state !== 'ESTABLISHED' || !Number.isSafeInteger(processId) || processId <= 0) continue;
    connections.push({
      localPort: portFromEndpoint(columns[1] || ''),
      remotePort: portFromEndpoint(columns[2] || ''),
      processId
    });
  }
  return connections;
}

function isRdpSessionName(value: string) {
  return /^rdp(?:-|_)?tcp(?:#|$)/i.test(value.trim());
}

export function evaluateRemoteGuardScan(input: RemoteGuardScanInput): RemoteGuardScanEvaluation {
  const findings = new Map<string, RemoteGuardFinding>();
  const processes = input.processesAvailable ? parseWindowsTasklist(input.tasklistOutput || '') : [];
  const sessions = input.windowsSessionsAvailable ? parseWindowsSessions(input.qwinstaOutput || '') : [];
  const connections = input.connections === 'available'
    ? parseEstablishedTcpConnections(input.netstatOutput || '')
    : [];

  const addFinding = (finding: RemoteGuardFinding) => {
    if (!findings.has(finding.code)) findings.set(finding.code, finding);
  };

  const currentProcess = processes.find((row) => row.processId === input.currentProcessId);
  if (currentProcess && isRdpSessionName(currentProcess.sessionName)) {
    addFinding({
      code: 'windows-rdp-current-session',
      label: '当前工作区正在 Windows 远程桌面会话中运行',
      severity: 'confirmed'
    });
  }

  if (sessions.some((row) => row.active && isRdpSessionName(row.sessionName))) {
    addFinding({
      code: 'windows-rdp-active-session',
      label: '检测到活动的 Windows 远程桌面会话',
      severity: 'confirmed'
    });
  }

  const uniqueRemoteProcesses = new Map<string, WindowsProcessRow>();
  for (const row of processes) {
    const imageName = row.imageName.toLowerCase();
    if (remoteHostProcesses[imageName] && !uniqueRemoteProcesses.has(imageName)) {
      uniqueRemoteProcesses.set(imageName, row);
    }
  }

  for (const [imageName, row] of uniqueRemoteProcesses) {
    addFinding({
      code: `remote-host-process:${imageName}`,
      label: remoteHostProcesses[imageName],
      severity: 'suspicious',
      processName: row.imageName
    });
  }

  if (input.connections === 'available') {
    const activeVnc = connections.some((connection) =>
      connection.localPort !== null && connection.localPort >= 5800 && connection.localPort <= 5999
    );
    if (activeVnc) {
      addFinding({
        code: 'vnc-established-session',
        label: '检测到 VNC 远控服务的活动连接',
        severity: 'confirmed'
      });
    }
  }

  const result = Array.from(findings.values());
  const threatActive = result.some((finding) => finding.severity === 'confirmed');
  const suspicious = result.some((finding) => finding.severity === 'suspicious');
  const degraded = !input.processesAvailable || !input.windowsSessionsAvailable || input.connections === 'unavailable';
  const state: RemoteGuardState = threatActive
    ? 'alarm'
    : suspicious
      ? 'suspicious'
      : degraded
        ? 'degraded'
        : 'guarding';
  const unavailable: string[] = [];
  if (!input.windowsSessionsAvailable) unavailable.push('Windows 会话');
  if (!input.processesAvailable) unavailable.push('远控进程');
  if (input.connections === 'unavailable') unavailable.push('VNC 连接');

  return {
    state,
    threatActive,
    findings: result,
    coverage: {
      windowsSessions: input.windowsSessionsAvailable,
      processes: input.processesAvailable,
      connections: input.connections
    },
    reason: unavailable.length ? `${unavailable.join('、')}巡检暂时不可用` : undefined
  };
}
