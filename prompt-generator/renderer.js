const secret = document.querySelector('#secret');
const zhEn = document.querySelector('#zh-en');
const enZh = document.querySelector('#en-zh');
const status = document.querySelector('#status');
const generate = document.querySelector('#generate');
let defaultPrompts = null;

function updateCount(input, output) {
  output.textContent = `${input.value.length} 字符`;
}
zhEn.addEventListener('input', () => updateCount(zhEn, document.querySelector('#zh-en-count')));
enZh.addEventListener('input', () => updateCount(enZh, document.querySelector('#en-zh-count')));
document.querySelector('#toggle-secret').addEventListener('click', event => {
  const show = secret.type === 'password';
  secret.type = show ? 'text' : 'password';
  event.currentTarget.textContent = show ? '隐藏' : '显示';
});
document.querySelector('#minimize').addEventListener('click', () => window.promptGenerator.minimize());
document.querySelector('#close').addEventListener('click', () => window.promptGenerator.close());

async function loadDefaultPrompts() {
  try {
    defaultPrompts = await window.promptGenerator.getDefaults();
    zhEn.value = defaultPrompts.chineseToEnglish || '';
    enZh.value = defaultPrompts.englishToChinese || '';
    updateCount(zhEn, document.querySelector('#zh-en-count'));
    updateCount(enZh, document.querySelector('#en-zh-count'));
  } catch (error) {
    status.className = 'error';
    status.textContent = error instanceof Error ? error.message : '默认提示词读取失败';
  }
}

generate.addEventListener('click', async () => {
  status.className = '';
  status.textContent = '';
  if (!secret.value.trim() || !zhEn.value.trim() || !enZh.value.trim()) {
    status.className = 'error';
    status.textContent = '请完整填写客户端当前密钥和两套提示词';
    return;
  }
  generate.disabled = true;
  try {
    const result = await window.promptGenerator.generate({
      secret: secret.value,
      chineseToEnglish: zhEn.value,
      englishToChinese: enZh.value
    });
    if (result?.canceled) return;
    secret.value = '';
    status.className = 'success';
    status.textContent = `已生成 ${result.fileName}，密钥输入已从界面清除`;
  } catch (error) {
    status.className = 'error';
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    generate.disabled = false;
  }
});

void loadDefaultPrompts();
