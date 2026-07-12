const api = window.licenseIssuer;

const setupPanel = document.getElementById('setupPanel');
const loginPanel = document.getElementById('loginPanel');
const issuerPanel = document.getElementById('issuerPanel');
const statusText = document.getElementById('statusText');
const lockText = document.getElementById('lockText');
const resultPanel = document.getElementById('resultPanel');
const licenseCodeInput = document.getElementById('licenseCode');

let lastLicenseCode = '';
let countdownTimer = null;

function setStatus(text) {
  statusText.textContent = text || '';
}

function show(panel) {
  for (const node of [setupPanel, loginPanel, issuerPanel]) node.classList.add('hidden');
  panel.classList.remove('hidden');
}

function formatRemain(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
}

function applyLock(status) {
  if (countdownTimer) window.clearInterval(countdownTimer);
  countdownTimer = null;
  const update = () => {
    const remain = (status.lockedUntil || 0) - Date.now();
    if (remain > 0) {
      lockText.classList.remove('hidden');
      lockText.textContent = `${status.message || '授权程序已锁定'}，剩余 ${formatRemain(remain)}`;
      document.getElementById('loginBtn').disabled = true;
      return;
    }
    lockText.classList.add('hidden');
    document.getElementById('loginBtn').disabled = false;
    if (countdownTimer) window.clearInterval(countdownTimer);
  };
  update();
  if ((status.lockedUntil || 0) > Date.now()) countdownTimer = window.setInterval(update, 1000);
}

async function refresh() {
  const status = await api.getStatus();
  setStatus(status.message || '');
  if (!status.initialized) {
    show(setupPanel);
    return;
  }
  show(loginPanel);
  applyLock(status);
}

async function loadSuite() {
  const suite = await api.getSuiteSummary();
  document.getElementById('suiteIdText').textContent = suite.suiteId;
  document.getElementById('keyIdText').textContent = suite.keyId;
}

document.getElementById('setupBtn').addEventListener('click', async () => {
  try {
    const password = document.getElementById('setupPassword').value;
    const confirm = document.getElementById('setupPasswordConfirm').value;
    if (password !== confirm) throw new Error('两次输入的密码不一致');
    const status = await api.initializePassword(password);
    setStatus(status.message || '授权程序密码已设置');
    show(loginPanel);
  } catch (error) {
    setStatus(error.message || '设置失败');
  }
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  try {
    const result = await api.login(document.getElementById('loginPassword').value);
    setStatus(result.message || '');
    applyLock(result);
    if (result.authenticated) {
      await loadSuite();
      show(issuerPanel);
    }
  } catch (error) {
    setStatus(error.message || '登录失败');
  }
});

document.getElementById('issueBtn').addEventListener('click', async () => {
  try {
    const output = await api.issueLicense({
      machineCode: document.getElementById('machineCode').value,
      username: document.getElementById('username').value,
      serviceSecret: document.getElementById('serviceSecret').value,
      authorizedDays: Number(document.getElementById('authorizedDays').value)
    });
    lastLicenseCode = output.licenseCode;
    licenseCodeInput.value = output.licenseCode;
    resultPanel.classList.remove('hidden');
    setStatus(`授权码已生成，套装 ${output.suiteId}`);
  } catch (error) {
    setStatus(error.message || '生成授权码失败');
  }
});

document.getElementById('copyCodeBtn').addEventListener('click', async () => {
  if (!lastLicenseCode) return setStatus('请先生成授权码');
  await api.copyText(lastLicenseCode);
  setStatus('授权码已复制');
});

document.getElementById('saveDatBtn').addEventListener('click', async () => {
  if (!lastLicenseCode) return setStatus('请先生成授权码');
  const result = await api.saveLicenseDat(lastLicenseCode);
  if (result.canceled) return;
  setStatus(`license.dat 已保存：${result.path}`);
});

document.getElementById('minimizeBtn').addEventListener('click', () => api.minimize());
document.getElementById('closeBtn').addEventListener('click', () => api.close());

refresh().catch((error) => setStatus(error.message || '授权程序启动失败'));
