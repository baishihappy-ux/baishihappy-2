<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { AppConfig, ChatProfile, Platform, PlatformInfo, TranslationCacheEntry } from '../electron/shared';

type Panel = 'apps' | 'home' | 'notice' | 'agency' | 'settings' | 'account' | 'session';
type ThemeName = 'light' | 'dark';
type RuntimeApp = 'whatsapp' | 'telegram' | 'signal';

type AppTile = {
  platform: Platform;
  app: RuntimeApp;
  label: string;
  short: string;
  color: string;
  icon: string;
};

type RuntimeTab = ChatProfile & {
  short: string;
  color: string;
  icon: string;
};

type MessageCandidate = {
  key: string;
  text: string;
  contactId?: string;
  contactIdType?: 'phone' | 'platform' | 'title' | 'unknown';
  contactTitle?: string;
  contactRemark?: string;
  contactKey?: string;
  direction?: 'incoming' | 'outgoing' | 'unknown';
  timestamp?: string;
  messagePart?: 'body' | 'quote';
};

const signedIn = ref(false);
const activePanel = ref<Panel>('apps');
const rememberPassword = ref(true);
const activeTheme = ref<ThemeName>('dark');
const themeMenuOpen = ref(false);
const profiles = ref<ChatProfile[]>([]);
const activeProfileId = ref<string | null>(null);
const configState = ref<AppConfig | null>(null);
const currentApp = ref<RuntimeApp>('whatsapp');
const platformCatalog = ref<PlatformInfo[]>([
  { platform: 'whatsapp', label: 'WhatsApp', url: 'https://web.whatsapp.com/' },
  { platform: 'telegram-a', label: 'Telegram A', url: 'https://web.telegram.org/a/' },
  { platform: 'telegram-k', label: 'Telegram K', url: 'https://web.telegram.org/k/' },
  { platform: 'signal', label: 'Signal', url: '' }
]);
const isCreatingProfile = ref(false);
const createDialogOpen = ref(false);
const newProfileName = ref('');
const createProfileError = ref('');
const closeTargetProfile = ref<RuntimeTab | null>(null);
const renameTargetProfile = ref<RuntimeTab | null>(null);
const renameProfileName = ref('');
const renameProfileError = ref('');
const isRenamingProfile = ref(false);
const draggingProfileId = ref<string | null>(null);
const translatedDrafts = ref<Record<string, string>>({});
const composerStatus = ref<Record<string, string>>({});
const typingProxyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const typingProxyText = '正在输入中文，此时对方会看到你正在输入...回车后即可发送英文';
const translationIntervals = new Map<string, ReturnType<typeof setInterval>>();
const composerInstallIntervals = new Map<string, ReturnType<typeof setInterval>>();
const composerEventPollIntervals = new Map<string, ReturnType<typeof setInterval>>();
const translatingMessages = new Set<string>();
const translatedMessages = new Set<string>();
const activeTranslationRequests = new Set<string>();
const translationCacheKey = 'df.translationCache.v1';
const translationCacheLimit = 1200;
const translationInitialCacheLimit = 1000;
const translationHistoryCachePageSize = 100;
const translationMemoryCaches = new Map<string, Map<string, string>>();
const translationCacheOffsets = new Map<string, number>();
const translationCacheLoadPromises = new Map<string, Promise<void>>();
const translationCacheExhausted = new Set<string>();
const translationCachePreloaded = new Set<string>();

const themeClass = computed(() => (activeTheme.value === 'light' ? 'theme-light' : 'theme-dark'));

const appTiles: AppTile[] = [
  { app: 'whatsapp', platform: 'whatsapp', label: 'WhatsApp', short: 'WA', color: '#22c55e', icon: 'WA' },
  { app: 'telegram', platform: 'telegram-a', label: 'Telegram', short: 'TG', color: '#35a8ff', icon: 'TG' },
  { app: 'signal', platform: 'signal', label: 'Signal', short: 'SG', color: '#5361ff', icon: 'SG' }
];

const activeProfile = computed(() => profiles.value.find((profile) => profile.id === activeProfileId.value) ?? null);
const activePlatformInfo = computed(() => {
  if (!activeProfile.value) return null;
  return platformCatalog.value.find((item) => item.platform === activeProfile.value?.platform) ?? null;
});
const activeWebUrl = computed(() => activePlatformInfo.value?.url ?? '');
const currentAppTile = computed(() => appTiles.find((tile) => tile.app === currentApp.value) ?? appTiles[0]);
const currentAppProfiles = computed(() => profiles.value.filter((profile) => appForPlatform(profile.platform) === currentApp.value));
const renderableProfiles = computed(() =>
  signedIn.value
    ? profiles.value
    .map((profile) => ({
      profile,
      url: platformCatalog.value.find((item) => item.platform === profile.platform)?.url ?? ''
    }))
    .filter((item) => item.url)
    : []
);
const workspaceTabs = computed<RuntimeTab[]>(() =>
  currentAppProfiles.value.map((profile) => {
    const tile = appTiles.find((item) => item.app === appForPlatform(profile.platform)) ?? appTiles[0];
    return { ...profile, short: tile.short, color: tile.color, icon: tile.icon };
  })
);
const hasActiveRenderableProfile = computed(() => Boolean(activeProfile.value && activeWebUrl.value));
const activeComposerStatus = computed(() => (activeProfileId.value ? composerStatus.value[activeProfileId.value] ?? '' : ''));
const canUseTranslatorComposer = computed(() => {
  const platform = activeProfile.value?.platform;
  return platform === 'whatsapp' || platform === 'telegram-a' || platform === 'telegram-k';
});

function setTheme(theme: ThemeName) {
  activeTheme.value = theme;
  themeMenuOpen.value = false;
}

async function loadRuntimeState() {
  if (!window.chatTranslator) return;

  const [config, catalog] = await Promise.all([window.chatTranslator.getConfig(), window.chatTranslator.getPlatformCatalog()]);
  applyConfig(config);
  platformCatalog.value = catalog;
}

function applyConfig(config: AppConfig) {
  configState.value = config;
  profiles.value = config.profiles;
  const restoredActiveId = config.profiles.some((profile) => profile.id === config.activeProfileId)
    ? config.activeProfileId
    : config.profiles[0]?.id ?? null;
  activeProfileId.value = restoredActiveId;
  if (activeProfile.value) {
    currentApp.value = appForPlatform(activeProfile.value.platform);
  } else if (config.profiles[0]) {
    currentApp.value = appForPlatform(config.profiles[0].platform);
  }
}

async function login() {
  signedIn.value = true;
  await loadRuntimeState();
  activePanel.value = profiles.value.length ? 'session' : 'apps';
}

function appForPlatform(platform: Platform): RuntimeApp {
  if (platform === 'whatsapp') return 'whatsapp';
  if (platform === 'signal') return 'signal';
  return 'telegram';
}

function platformForApp(app: RuntimeApp): Platform {
  if (app === 'whatsapp') return 'whatsapp';
  if (app === 'signal') return 'signal';
  return 'telegram-a';
}

function selectRuntimeApp(app: RuntimeApp) {
  currentApp.value = app;
  activePanel.value = 'session';
  const nextActiveId = profiles.value.find((profile) => appForPlatform(profile.platform) === app)?.id ?? null;
  activeProfileId.value = nextActiveId;
  if (nextActiveId) {
    void persistActiveProfile(nextActiveId);
  }
}

function selectRuntimeTab(profileId: string) {
  activeProfileId.value = profileId;
  void persistActiveProfile(profileId);
  void focusInjectedChineseComposer();
}

function nextProfileName(app: RuntimeApp) {
  const prefix = app === 'whatsapp' ? 'WS' : app === 'telegram' ? 'TG' : 'SG';
  const next = profiles.value.filter((profile) => appForPlatform(profile.platform) === app).length + 1;
  return `${prefix}${String(next).padStart(2, '0')}`;
}

function openCreateProfileDialog() {
  isCreatingProfile.value = false;
  createProfileError.value = '';
  newProfileName.value = nextProfileName(currentApp.value);
  createDialogOpen.value = true;
}

async function confirmCreateProfile() {
  if (isCreatingProfile.value) return;
  const platform = platformForApp(currentApp.value);
  const profileName = newProfileName.value.trim() || nextProfileName(currentApp.value);
  isCreatingProfile.value = true;
  createProfileError.value = '';
  try {
    if (!window.chatTranslator) {
      throw new Error('Electron persistence API is unavailable.');
    }

    const profile = await window.chatTranslator.createProfile(platform, profileName);
    const config = await window.chatTranslator.getConfig();
    if (!config.profiles.some((item) => item.id === profile.id)) {
      throw new Error(`Profile ${profile.name} was not persisted.`);
    }
    applyConfig({ ...config, activeProfileId: profile.id });
    activePanel.value = 'session';
    createDialogOpen.value = false;
  } catch (error) {
    createProfileError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isCreatingProfile.value = false;
  }
}

function requestCloseProfile(profile: RuntimeTab) {
  closeTargetProfile.value = profile;
}

function requestRenameProfile(profile: RuntimeTab) {
  renameTargetProfile.value = profile;
  renameProfileName.value = profile.name;
  renameProfileError.value = '';
}

async function confirmRenameProfile() {
  if (!renameTargetProfile.value || isRenamingProfile.value) return;
  const target = renameTargetProfile.value;
  const nextName = renameProfileName.value.trim();
  if (!nextName) {
    renameProfileError.value = '请输入自定义名称';
    return;
  }
  if (nextName === target.name) {
    renameTargetProfile.value = null;
    return;
  }
  isRenamingProfile.value = true;
  renameProfileError.value = '';
  try {
    if (!window.chatTranslator?.renameProfile) {
      throw new Error('Electron rename API is unavailable.');
    }
    const config = await window.chatTranslator.renameProfile(target.id, nextName);
    for (const key of Array.from(translationMemoryCaches.keys())) {
      if (key.startsWith(`${target.id}:`)) translationMemoryCaches.delete(key);
    }
    translationCacheOffsets.delete(target.id);
    translationCacheLoadPromises.delete(target.id);
    translationCacheExhausted.delete(target.id);
    translationCachePreloaded.delete(target.id);
    applyConfig(config);
    activeProfileId.value = target.id;
    currentApp.value = appForPlatform(target.platform);
    renameTargetProfile.value = null;
  } catch (error) {
    renameProfileError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isRenamingProfile.value = false;
  }
}

async function confirmCloseProfile() {
  if (!closeTargetProfile.value || !window.chatTranslator) return;
  const targetId = closeTargetProfile.value.id;
  const selectedApp = currentApp.value;
  profiles.value = profiles.value.filter((profile) => profile.id !== targetId);
  if (activeProfileId.value === targetId) {
    activeProfileId.value = currentAppProfiles.value[0]?.id ?? null;
  }
  closeTargetProfile.value = null;
  await nextTick();
  const config = await window.chatTranslator.removeProfile(targetId);
  translationMemoryCaches.delete(targetId);
  translationCacheOffsets.delete(targetId);
  translationCacheLoadPromises.delete(targetId);
  translationCacheExhausted.delete(targetId);
  translationCachePreloaded.delete(targetId);
  applyConfig(config);
  currentApp.value = selectedApp;
  if (!activeProfileId.value || appForPlatform(activeProfile.value?.platform ?? 'whatsapp') !== selectedApp) {
    activeProfileId.value = currentAppProfiles.value[0]?.id ?? null;
  }
}

async function persistProfileOrder(nextProfiles: ChatProfile[]) {
  profiles.value = nextProfiles;
  if (!window.chatTranslator || !configState.value) return;
  const saved = await window.chatTranslator.saveConfig({
    ...configState.value,
    profiles: nextProfiles,
    activeProfileId: activeProfileId.value
  });
  configState.value = saved;
}

async function persistActiveProfile(profileId: string) {
  if (!window.chatTranslator || !configState.value) return;
  const saved = await window.chatTranslator.saveConfig({
    ...configState.value,
    profiles: profiles.value,
    activeProfileId: profileId
  });
  configState.value = saved;
}

function handleTabDragStart(profileId: string) {
  draggingProfileId.value = profileId;
}

function handleTabDrop(targetId: string) {
  const sourceId = draggingProfileId.value;
  draggingProfileId.value = null;
  if (!sourceId || sourceId === targetId) return;

  const appProfileIds = currentAppProfiles.value.map((profile) => profile.id);
  const orderedAppIds = appProfileIds.filter((id) => id !== sourceId);
  const targetIndex = orderedAppIds.indexOf(targetId);
  orderedAppIds.splice(targetIndex < 0 ? orderedAppIds.length : targetIndex, 0, sourceId);

  const appQueue = orderedAppIds.map((id) => profiles.value.find((profile) => profile.id === id)).filter(Boolean) as ChatProfile[];
  const nextProfiles = profiles.value.map((profile) => {
    if (appForPlatform(profile.platform) !== currentApp.value) return profile;
    return appQueue.shift() ?? profile;
  });
  void persistProfileOrder(nextProfiles);
}

function reloadActiveWebview() {
  const profileId = activeProfileId.value;
  if (!profileId) return;
  const webview = document.querySelector<Electron.WebviewTag>(`webview[data-profile-id="${profileId}"]`);
  webview?.reload();
}

function getActiveWebview() {
  const profileId = activeProfileId.value;
  if (!profileId) return null;
  return document.querySelector<Electron.WebviewTag>(`webview[data-profile-id="${profileId}"]`);
}

function setComposerStatus(profileId: string, status: string) {
  composerStatus.value = { ...composerStatus.value, [profileId]: status };
}

async function focusInjectedChineseComposer() {
  const webview = getActiveWebview();
  if (!webview) return;
  await webview.executeJavaScript(buildInjectedComposerScript('focus'), true);
}

function scheduleTypingProxy(profileId: string) {
  const existingTimer = typingProxyTimers.get(profileId);
  if (existingTimer) clearTimeout(existingTimer);

  const timer = setTimeout(() => {
    if (activeProfileId.value !== profileId) return;
    setComposerStatus(profileId, '');
    void clearNativeComposerIfProxy(profileId);
  }, 1000);
  typingProxyTimers.set(profileId, timer);
}

async function handleInjectedComposerEvent(profileId: string, action: string, text: string) {
  const profile = profiles.value.find((item) => item.id === profileId);
  if (!profile || !window.chatTranslator || appForPlatform(profile.platform) === 'signal') return;

  if (action === 'typing') return;

  if (action === 'translate' && text.trim()) {
    if (activeTranslationRequests.has(profileId)) return;
    activeTranslationRequests.add(profileId);
    window.setTimeout(() => activeTranslationRequests.delete(profileId), 8000);
    setComposerStatus(profileId, '翻译中');
    await setInjectedComposerState(profileId, { status: '翻译中' });
    try {
      const englishText = await window.chatTranslator.translate({ text: text.trim(), from: 'Chinese', to: 'English' });
      if (!englishText) throw new Error('empty translation');
      translatedDrafts.value = { ...translatedDrafts.value, [profileId]: englishText };
      await writeNativeComposer(profileId, englishText, { instant: true });
      await setInjectedComposerState(profileId, { status: '英文已替换，回车发送', translated: englishText });
      setComposerStatus(profileId, '英文已替换，回车发送');
    } catch (error) {
      console.error(error);
      setComposerStatus(profileId, '翻译失败：检查 DeepSeek 密钥或网络');
      await setInjectedComposerState(profileId, { status: '翻译失败：检查 DeepSeek 密钥或网络' });
    }
    activeTranslationRequests.delete(profileId);
    return;
  }

  if (action === 'typing') {
    translatedDrafts.value = { ...translatedDrafts.value, [profileId]: '' };
    await pulseNativeTyping(profileId);
    setComposerStatus(profileId, text.trim() ? '中文输入中' : '');
    scheduleTypingProxy(profileId);
    return;
  }

  if (action === 'send') {
    setComposerStatus(profileId, '发送中');
    await sendNativeComposer(profileId);
    translatedDrafts.value = { ...translatedDrafts.value, [profileId]: '' };
    await setInjectedComposerState(profileId, { draft: '', status: '' });
    setComposerStatus(profileId, '');
    return;
  }

  if (action !== 'translate' || !text.trim()) return;
  setComposerStatus(profileId, '翻译中');
  await setInjectedComposerState(profileId, { status: '翻译中' });
  await clearNativeComposerIfProxy(profileId);
  const englishText = await window.chatTranslator.translate({ text: text.trim(), from: 'Chinese', to: 'English' });
  translatedDrafts.value = { ...translatedDrafts.value, [profileId]: englishText };
  await writeNativeComposer(profileId, englishText, { instant: false });
  await setInjectedComposerState(profileId, { status: '英文已写入，回车发送', translated: englishText });
  setComposerStatus(profileId, '英文已写入，回车发送');
}

function getWebviewByProfileId(profileId: string) {
  return document.querySelector<Electron.WebviewTag>(`webview[data-profile-id="${profileId}"]`);
}

async function writeNativeComposer(profileId: string, text: string, options: { instant: boolean }) {
  const webview = getWebviewByProfileId(profileId);
  if (!webview) return;
  if (options.instant) {
    const pasted = await pasteTextIntoNativeComposer(webview, text);
    if (pasted) return;
  }
  const result = await webview.executeJavaScript(buildComposerScript('write', text, options.instant), true) as { ok?: boolean; reason?: string } | undefined;
  if (!result?.ok) {
    throw new Error(`native composer write failed: ${result?.reason || 'unknown'}`);
  }
}

async function pasteTextIntoNativeComposer(webview: Electron.WebviewTag, text: string) {
  if (!window.chatTranslator?.readClipboardText || !window.chatTranslator?.writeClipboardText || typeof webview.sendInputEvent !== 'function') {
    return false;
  }

  const focused = await webview.executeJavaScript(buildNativeComposerFocusScript(), true) as boolean;
  if (!focused) return false;

  const previousClipboard = await window.chatTranslator.readClipboardText();
  const send = (event: Record<string, unknown>) => webview.sendInputEvent(event);
  try {
    await window.chatTranslator.writeClipboardText(text);
    webview.focus();
    send({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
    send({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
    send({ type: 'keyDown', keyCode: 'Backspace' });
    send({ type: 'keyUp', keyCode: 'Backspace' });
    send({ type: 'keyDown', keyCode: 'V', modifiers: ['control'] });
    send({ type: 'keyUp', keyCode: 'V', modifiers: ['control'] });
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const currentText = await webview.executeJavaScript(buildNativeComposerTextScript(), true) as string;
    return normalizeCacheText(currentText) === normalizeCacheText(text);
  } finally {
    await window.chatTranslator.writeClipboardText(previousClipboard);
  }
}

async function clearNativeComposerIfProxy(profileId?: string) {
  const webview = profileId ? getWebviewByProfileId(profileId) : getActiveWebview();
  if (!webview) return;
  await webview.executeJavaScript(buildComposerScript('clearProxy', typingProxyText, true, true), true);
}

async function pulseNativeTyping(profileId: string) {
  const webview = getWebviewByProfileId(profileId);
  if (!webview) return;
  await webview.executeJavaScript(buildInjectedComposerScript('focusNative'), true);
}

async function sendNativeComposer(profileId: string) {
  const webview = getWebviewByProfileId(profileId);
  if (!webview) return;
  await webview.executeJavaScript(buildComposerScript('send', '', true), true);
}

async function setInjectedComposerState(profileId: string, state: Record<string, string>) {
  const webview = getWebviewByProfileId(profileId);
  if (!webview) return;
  await webview.executeJavaScript(buildInjectedComposerScript('state', state), true);
}

async function pollInjectedComposerEvents(profileId: string) {
  const webview = getWebviewByProfileId(profileId);
  if (!webview) return;
  let events: Array<{ action?: string; text?: string }> = [];
  try {
    events = (await webview.executeJavaScript(
      `(() => { const q = window.__dfTranslatorQueue || []; window.__dfTranslatorQueue = []; return q; })()`,
      true
    )) as Array<{ action?: string; text?: string }>;
  } catch {
    return;
  }
  for (const event of events) {
    if (!event.action) continue;
    await handleInjectedComposerEvent(profileId, event.action, event.text || '');
  }
}

function buildComposerScript(action: 'write' | 'clearProxy' | 'send' | 'pulse', text: string, instant: boolean, preserveFocus = false) {
  const payload = JSON.stringify({ action, text, instant, preserveFocus });
  return `
(async () => {
  const payload = ${payload};
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 12 && rect.height > 12 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const findComposer = () => {
    const selectors = [
      'footer [contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][role="textbox"]',
      'div.input-message-input[contenteditable="true"]',
      '#editable-message-text',
      'textarea'
    ];
    for (const selector of selectors) {
      const items = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (items.length) return items[items.length - 1];
    }
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(isVisible);
    return editables[editables.length - 1] || null;
  };
  const dispatchInput = (el) => {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const dispatchDelete = (el) => {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const dispatchBeforeInput = (el, inputType, data = null) => {
    try {
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType, data }));
    } catch {}
  };
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const restoreTranslatorFocus = (previousActiveElement) => {
    if (!payload.preserveFocus) return;
    const target = previousActiveElement;
    const restore = () => {
      if (target?.isConnected && document.activeElement !== target) target.focus();
    };
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 30);
    setTimeout(restore, 90);
    setTimeout(restore, 180);
  };
  const setText = (el, value) => {
    const previousActiveElement = document.activeElement;
    if (!payload.preserveFocus) el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      setter?.call(el, value);
      dispatchInput(el);
      restoreTranslatorFocus(previousActiveElement);
      return;
    }
    const selection = window.getSelection();
    const selectContents = () => {
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    selectContents();
    dispatchBeforeInput(el, 'deleteContentBackward');
    document.execCommand('delete', false);
    el.textContent = '';
    dispatchDelete(el);
    if (!value) {
      restoreTranslatorFocus(previousActiveElement);
      return;
    }
    dispatchBeforeInput(el, 'insertText', value);
    el.textContent = value;
    const caretRange = document.createRange();
    caretRange.selectNodeContents(el);
    caretRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(caretRange);
    dispatchInput(el);
    restoreTranslatorFocus(previousActiveElement);
  };
  const appendText = (el, value) => {
    if (!payload.preserveFocus) el.focus();
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      setter?.call(el, (el.value || '') + value);
      dispatchInput(el);
      return;
    }
    document.execCommand('insertText', false, value);
    dispatchInput(el);
  };
  const composer = findComposer();
  if (!composer) return { ok: false, reason: 'composer-not-found' };
  const getText = (el) => ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) ? el.value : el.textContent) || '';

  if (payload.action === 'pulse') {
    const currentText = getText(composer).trim();
    if (!currentText) {
      setText(composer, 'typing...');
    }
    restoreTranslatorFocus(composer);
    return { ok: true, method: 'pulse' };
  }

  if (payload.action === 'clearProxy') {
    const currentText = getText(composer);
    if ((currentText || '').trim() === payload.text.trim() || (currentText || '').trim() === 'typing...') setText(composer, '');
    return { ok: true };
  }

  if (payload.action === 'send') {
    const currentText = getText(composer).trim();
    if (!currentText || currentText === 'typing...' || /[\\u4e00-\\u9fff]/.test(currentText) || !/[A-Za-z]/.test(currentText)) {
      return { ok: false, reason: 'blocked-non-english' };
    }
    composer.focus();
    const sendButton = Array.from(document.querySelectorAll('button, [role="button"]')).find((button) => {
      const label = ((button.getAttribute('aria-label') || '') + ' ' + (button.getAttribute('data-testid') || '') + ' ' + (button.textContent || '')).toLowerCase();
      return /send|send message|发送/.test(label);
    });
    if (sendButton) {
      sendButton.click();
      return { ok: true, method: 'button' };
    }
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    composer.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return { ok: true, method: 'enter' };
  }

  window.__dfTranslatorNativeWrite = true;
  if (normalize(getText(composer)) === normalize(payload.text)) {
    window.setTimeout(() => { window.__dfTranslatorNativeWrite = false; }, 120);
    return { ok: true, method: 'already-written' };
  }
  setText(composer, '');
  if (payload.instant) {
    setText(composer, payload.text);
    window.setTimeout(() => { window.__dfTranslatorNativeWrite = false; }, 120);
    return normalize(getText(composer)) === normalize(payload.text)
      ? { ok: true, method: 'instant' }
      : { ok: false, reason: 'write-verification-failed', current: getText(composer) };
  }
  for (const char of Array.from(payload.text)) {
    appendText(composer, char);
    await sleep(35 + Math.floor(Math.random() * 45));
  }
  window.setTimeout(() => { window.__dfTranslatorNativeWrite = false; }, 120);
  return { ok: true, method: 'typewriter' };
})()
`;
}

function buildNativeComposerHelpersScript(returnText: boolean) {
  return `
(() => {
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 40 && rect.height > 16 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const selectors = [
    'footer [contenteditable="true"][role="textbox"]',
    'footer [contenteditable="true"]',
    '[data-testid="conversation-compose-box-input"]',
    '[data-testid="input-message-input"]',
    '[contenteditable="true"][role="textbox"]',
    'div.input-message-input[contenteditable="true"]',
    '.input-message-input[contenteditable="true"]',
    '.composer_rich_textarea',
    '.editable-message-text',
    '#editable-message-text',
    'textarea'
  ];
  let composer = null;
  for (const selector of selectors) {
    const items = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    if (items.length) composer = items[items.length - 1];
  }
  if (!composer) return ${returnText ? "''" : 'false'};
  if (!${returnText}) {
    composer.focus();
    return true;
  }
  return composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement
    ? composer.value || ''
    : composer.innerText || composer.textContent || '';
})()
`;
}

function buildNativeComposerFocusScript() {
  return buildNativeComposerHelpersScript(false);
}

function buildNativeComposerTextScript() {
  return buildNativeComposerHelpersScript(true);
}

function buildInjectedComposerScript(action: 'install' | 'focus' | 'focusNative' | 'state', state: Record<string, string> = {}) {
  const payload = JSON.stringify({ action, state });
  return `
(() => {
  const payload = ${payload};
  const installStyle = () => {
    if (document.getElementById('wc-composer-style')) return;
    const style = document.createElement('style');
    style.id = 'wc-composer-style';
    style.textContent = \`
      .wc-composer-host {
        display: none !important;
        gap: 6px;
        width: 100%;
        max-width: 100%;
        padding: 6px 10px 8px;
        background: transparent;
        box-sizing: border-box;
      }
      .wc-composer-proxy {
        min-height: 20px;
        color: rgba(90, 95, 105, .68);
        font-size: 12px;
        line-height: 20px;
        overflow: hidden;
      }
      .wc-composer-proxy span {
        display: inline-block;
        text-decoration-line: underline;
        text-decoration-style: wavy;
        text-decoration-color: rgba(90, 95, 105, .42);
        text-underline-offset: 4px;
        animation: dfTypingWave 1.12s ease-in-out infinite;
      }
      .wc-composer-input {
        width: 100%;
        min-height: 42px;
        max-height: 96px;
        border: 1px solid rgba(120, 130, 150, .25);
        border-radius: 9px;
        padding: 10px 12px;
        color: #111827;
        background: rgba(255, 255, 255, .92);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.8), 0 5px 16px rgba(0,0,0,.08);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        resize: none;
        outline: none;
        box-sizing: border-box;
        caret-color: transparent;
      }
      .wc-composer-input:focus {
        border-color: rgba(34, 197, 94, .45);
        box-shadow: 0 0 0 3px rgba(34,197,94,.12), inset 0 1px 0 rgba(255,255,255,.8);
      }
      .wc-composer-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: rgba(90, 95, 105, .72);
        font-size: 12px;
        line-height: 16px;
      }
      @keyframes dfTypingWave {
        0%,100% { transform: translateY(0); opacity: .6; }
        50% { transform: translateY(-2px); opacity: .95; }
      }
    \`;
    document.head.appendChild(style);
  };
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 60 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const findNativeComposer = () => {
    const selectors = [
      'footer [contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      '[data-testid="conversation-compose-box-input"]',
      '[data-testid="input-message-input"]',
      '[contenteditable="true"][role="textbox"]',
      'div.input-message-input[contenteditable="true"]',
      '.input-message-input[contenteditable="true"]',
      '.composer_rich_textarea',
      '.editable-message-text',
      '#editable-message-text',
      'textarea'
    ];
    for (const selector of selectors) {
      const items = Array.from(document.querySelectorAll(selector)).filter(isVisible);
      if (items.length) return items[items.length - 1];
    }
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], textarea')).filter(isVisible);
    return editables[editables.length - 1] || null;
  };
  const findComposerContainer = (composer) => {
    const footer = composer.closest('footer');
    if (footer && isVisible(footer)) return footer;
    const telegramFooter = composer.closest('.chat-input, .input-message-container, .new-message-wrapper, .MessageInput, [class*="input"]');
    if (telegramFooter && isVisible(telegramFooter)) return telegramFooter;
    let node = composer;
    for (let i = 0; i < 8 && node; i += 1) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 280 && rect.height >= 40) return node;
      node = node.parentElement;
    }
    return composer.parentElement;
  };
  const ensureHost = () => {
    installStyle();
    const composer = findNativeComposer();
    if (!composer) return null;
    const container = findComposerContainer(composer);
    if (!container) return null;
    let host = document.getElementById('wc-composer-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'wc-composer-host';
      host.className = 'wc-composer-host';
      host.innerHTML = \`
        <div class="wc-composer-proxy" hidden><span>正在输入中文，此时对方会看到你正在输入...回车后即可发送英文</span></div>
        <textarea class="wc-composer-input" rows="1" readonly placeholder="输入中文，回车翻译成英文，再回车发送；Shift+Enter 换行"></textarea>
        <div class="wc-composer-meta"><span class="wc-composer-status">中文输入框已就绪</span><span>Workspace Core</span></div>
      \`;
      container.appendChild(host);
    } else if (host.parentElement !== container) {
      container.appendChild(host);
    }
    const input = host.querySelector('.wc-composer-input');
    const status = host.querySelector('.wc-composer-status');
    const proxy = host.querySelector('.wc-composer-proxy');
    const queueEvent = (payload) => {
      if (payload.action === 'translate') {
        const textKey = (payload.text || '').trim();
        const now = Date.now();
        const last = window.__dfTranslatorLastTranslate || {};
        if (last.text === textKey && now - last.at < 1000) return;
        window.__dfTranslatorLastTranslate = { text: textKey, at: now };
      }
      window.__dfTranslatorQueue = Array.isArray(window.__dfTranslatorQueue) ? window.__dfTranslatorQueue : [];
      window.__dfTranslatorQueue.push({ ...payload, at: Date.now() });
    };
    const getComposerText = () => composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement ? composer.value : composer.textContent || '';
    const setComposerText = (value) => {
      if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), 'value')?.set;
        setter?.call(composer, value);
      } else {
        composer.textContent = value;
      }
      composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward', data: null }));
      composer.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const pulseTypingIndicator = () => {
      window.clearTimeout(window.__dfTranslatorPulseTimer);
      if (!getComposerText().trim()) setComposerText(' ');
      window.__dfTranslatorPulseTimer = window.setTimeout(() => {
        if (getComposerText() === ' ') setComposerText('');
        composer.focus();
      }, 650);
    };
    const appendChineseDraft = (text) => {
      if (!text) return;
      input.value += text;
      input.style.height = 'auto';
      input.style.height = Math.min(96, Math.max(42, input.scrollHeight)) + 'px';
      proxy.hidden = !input.value.trim();
      delete input.dataset.dfTranslated;
      pulseTypingIndicator();
      queueEvent({ action: 'typing', text: input.value });
    };
    const captureNativeDraft = () => {
      return false;
      if (window.__dfTranslatorNativeWrite) return false;
      const text = getComposerText();
      if (!text || text === ' ' || text === 'typing...') return false;
      if (!/[\\u4e00-\\u9fff]/.test(text) && !input.value.trim()) return false;
      appendChineseDraft(text);
      setComposerText('');
      composer.focus();
      return true;
    };
    const blockChineseNativeSend = (event) => {
      const text = getComposerText();
      if (!/[\\u4e00-\\u9fff]/.test(text) && text.trim() !== 'typing...') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      status.textContent = '已拦截中文发送，正在翻译';
    };
    if (!composer.dataset.dfNativeGuard) {
      composer.dataset.dfNativeGuard = '1';
      composer.addEventListener('input', () => {
        captureNativeDraft();
      }, true);
      composer.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          const text = getComposerText();
          if (/[\\u4e00-\\u9fff]/.test(text)) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            queueEvent({ action: 'translate', text });
            return;
          }
        }
      }, true);
      composer.addEventListener('compositionend', () => {
        window.setTimeout(captureNativeDraft, 0);
      }, true);
      composer.addEventListener('beforeinput', (event) => {
        if (event.inputType === 'insertLineBreak' && /[\\u4e00-\\u9fff]/.test(getComposerText())) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          queueEvent({ action: 'translate', text: getComposerText() });
        }
      }, true);
      document.addEventListener('click', (event) => {
        const target = event.target;
        const button = target?.closest?.('button, [role="button"]');
        if (!button) return;
        const label = ((button.getAttribute('aria-label') || '') + ' ' + (button.getAttribute('data-testid') || '') + ' ' + (button.textContent || '')).toLowerCase();
        if (/send|send message|发送/.test(label)) blockChineseNativeSend(event);
      }, true);
    }
    if (!input.dataset.dfBound) {
      input.dataset.dfBound = '1';
      input.addEventListener('focus', () => composer.focus());
      input.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        composer.focus();
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(96, Math.max(42, input.scrollHeight)) + 'px';
        proxy.hidden = !input.value.trim();
        queueEvent({ action: 'typing', text: input.value });
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        queueEvent({
          action: input.dataset.dfTranslated ? 'send' : 'translate',
          text: input.value
        });
      });
    }
    return { host, input, status, proxy };
  };

  const parts = ensureHost();
  if (!parts) return false;
  if (payload.action === 'focus') {
    findNativeComposer()?.focus();
    parts.host.classList.add('wc-composer-active');
    return true;
  }
  if (payload.action === 'focusNative') {
    findNativeComposer()?.focus();
    return true;
  }
  if (payload.action === 'state') {
    if (Object.prototype.hasOwnProperty.call(payload.state, 'draft')) {
      parts.input.value = payload.state.draft || '';
      parts.input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (Object.prototype.hasOwnProperty.call(payload.state, 'status')) {
      parts.status.textContent = payload.state.status || '中文输入框已就绪';
    }
    if (Object.prototype.hasOwnProperty.call(payload.state, 'translated')) {
      if (payload.state.translated) parts.input.dataset.dfTranslated = payload.state.translated;
      else delete parts.input.dataset.dfTranslated;
    }
    return true;
  }
  return true;
})()
`;
}

function buildEnterTranslateScript() {
  return `
(() => {
  const installVersion = '2026-07-07-native-enter-v2';
  if (window.__dfEnterTranslateInstalled === installVersion) return true;
  window.__dfEnterTranslateInstalled = installVersion;

  const hasChinese = (text) => /[\\u4e00-\\u9fff]/.test(text || '');
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 40 && rect.height > 16 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const getText = (el) => {
    if (!el) return '';
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return el.value || '';
    return el.innerText || el.textContent || '';
  };
  const isComposer = (el) => {
    if (!el || !isVisible(el)) return false;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return true;
    if (el.getAttribute('contenteditable') !== 'true') return false;
    if (el.closest('[role="dialog"]')) return false;
    return Boolean(el.closest('footer, [class*="composer"], [class*="input"], [class*="message-input"], [class*="chat-input"]'));
  };
  const findComposer = () => {
    const active = document.activeElement;
    if (isComposer(active)) return active;
    const selectors = [
      'footer [contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      '[data-testid="conversation-compose-box-input"]',
      '[data-testid="input-message-input"]',
      '[contenteditable="true"][role="textbox"]',
      'div.input-message-input[contenteditable="true"]',
      '.input-message-input[contenteditable="true"]',
      '.composer_rich_textarea',
      '.editable-message-text',
      '#editable-message-text',
      'textarea'
    ];
    for (const selector of selectors) {
      const items = Array.from(document.querySelectorAll(selector)).filter(isComposer);
      if (items.length) return items[items.length - 1];
    }
    return null;
  };
  const queueTranslate = (text) => {
    const textKey = (text || '').trim();
    const now = Date.now();
    const last = window.__dfTranslatorLastTranslate || {};
    if (last.text === textKey && now - last.at < 1000) return;
    window.__dfTranslatorLastTranslate = { text: textKey, at: now };
    window.__dfTranslatorQueue = Array.isArray(window.__dfTranslatorQueue) ? window.__dfTranslatorQueue : [];
    window.__dfTranslatorQueue.push({ action: 'translate', text, at: Date.now() });
  };
  const blockAndTranslate = (event, composer) => {
    const text = getText(composer).trim();
    if (!hasChinese(text)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    queueTranslate(text);
    return true;
  };
  const handler = (event) => {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const composer = isComposer(event.target) ? event.target : findComposer();
    if (!composer) return;
    blockAndTranslate(event, composer);
  };
  const beforeInputHandler = (event) => {
    if (event.defaultPrevented || event.isComposing || event.inputType !== 'insertLineBreak') return;
    const composer = isComposer(event.target) ? event.target : findComposer();
    if (!composer) return;
    blockAndTranslate(event, composer);
  };
  document.addEventListener('keydown', handler, true);
  document.addEventListener('beforeinput', beforeInputHandler, true);
  return true;
})()
`;
}

function minimizeWindow() {
  void window.windowControl?.minimize();
}

function toggleMaximizeWindow() {
  void window.windowControl?.toggleMaximize();
}

function closeWindow() {
  void window.windowControl?.close();
}

function normalizeCacheText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function hashText(text: string) {
  let hash = 2166136261;
  for (const char of normalizeCacheText(text)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cacheScope(profileId: string, candidate?: Partial<MessageCandidate>) {
  return `${profileId}:${candidate?.contactKey || candidate?.contactId || 'unknown-contact'}`;
}

function profileTranslationCache(profileId: string, candidate?: Partial<MessageCandidate>) {
  const scope = cacheScope(profileId, candidate);
  let cache = translationMemoryCaches.get(scope);
  if (!cache) {
    cache = new Map<string, string>();
    translationMemoryCaches.set(scope, cache);
  }
  return cache;
}

function applyTranslationCacheEntries(profileId: string, entries: TranslationCacheEntry[], candidate?: Partial<MessageCandidate>) {
  const cache = profileTranslationCache(profileId, candidate);
  for (const entry of entries) {
    if (entry.sourceHash && entry.translatedText) {
      cache.set(entry.sourceHash, entry.translatedText);
    }
  }
}

async function loadTranslationCachePage(profileId: string, limit: number, offset = translationCacheOffsets.get(profileId) ?? 0) {
  if (!window.chatTranslator?.loadTranslationCache || translationCacheExhausted.has(profileId)) return;
  const entries = await window.chatTranslator.loadTranslationCache({ profileId, offset, limit });
  applyTranslationCacheEntries(profileId, entries);
  translationCacheOffsets.set(profileId, offset + entries.length);
  if (entries.length < limit) {
    translationCacheExhausted.add(profileId);
  }
}

function preloadTranslationCache(profileId: string) {
  if (translationCachePreloaded.has(profileId)) return Promise.resolve();
  if (translationCacheLoadPromises.has(profileId)) return translationCacheLoadPromises.get(profileId);
  const promise = loadTranslationCachePage(profileId, translationInitialCacheLimit, 0)
    .catch(() => undefined)
    .finally(() => {
      translationCachePreloaded.add(profileId);
      translationCacheLoadPromises.delete(profileId);
    });
  translationCacheLoadPromises.set(profileId, promise);
  return promise;
}

async function loadMoreTranslationCache(profileId: string) {
  if (translationCacheLoadPromises.has(profileId)) {
    await translationCacheLoadPromises.get(profileId);
    return;
  }
  const promise = loadTranslationCachePage(profileId, translationHistoryCachePageSize)
    .catch(() => undefined)
    .finally(() => {
      translationCacheLoadPromises.delete(profileId);
    });
  translationCacheLoadPromises.set(profileId, promise);
  await promise;
}

function readTranslationCache(): Record<string, { text: string; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(translationCacheKey) || '{}') as Record<string, { text: string; at: number }>;
  } catch {
    return {};
  }
}

function getCachedTranslation(profileId: string, sourceText: string, candidate?: Partial<MessageCandidate>) {
  const sourceHash = hashText(sourceText);
  const scope = cacheScope(profileId, candidate);
  return profileTranslationCache(profileId, candidate).get(sourceHash) || readTranslationCache()[`${scope}:${sourceHash}`]?.text || '';
}

function setCachedTranslation(profile: ChatProfile, candidate: MessageCandidate, translatedText: string) {
  const sourceText = candidate.text;
  const sourceHash = hashText(sourceText);
  const scope = cacheScope(profile.id, candidate);
  profileTranslationCache(profile.id, candidate).set(sourceHash, translatedText);
  const cache = readTranslationCache();
  cache[`${scope}:${sourceHash}`] = { text: translatedText, at: Date.now() };
  const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, translationCacheLimit);
  localStorage.setItem(translationCacheKey, JSON.stringify(Object.fromEntries(entries)));
  void window.chatTranslator?.saveTranslationCacheEntry?.({
    profileId: profile.id,
    platform: profile.platform,
    profileName: profile.name,
    contactId: candidate.contactId,
    contactIdType: candidate.contactIdType,
    contactTitle: candidate.contactTitle,
    contactRemark: candidate.contactRemark,
    sourceHash,
    sourceText: normalizeCacheText(sourceText),
    translatedText,
    direction: candidate.direction,
    timestamp: candidate.timestamp,
    messagePart: candidate.messagePart
  });
}

function handleWebviewDomReady(event: Event, profile: ChatProfile) {
  const webview = event.currentTarget as Electron.WebviewTag | null;
  if (!webview) return;

  void webview.executeJavaScript(buildFingerprintScript(profile), true);
  void preloadTranslationCache(profile.id);
  if (appForPlatform(profile.platform) !== 'signal') {
    startComposerInstallLoop(profile.id);
  }
  startTranslationBridge(profile.id);
}

function startComposerInstallLoop(profileId: string) {
  if (composerInstallIntervals.has(profileId)) return;
  const install = async () => {
    const profile = profiles.value.find((item) => item.id === profileId);
    if (!profile || appForPlatform(profile.platform) === 'signal') return;
    const webview = getWebviewByProfileId(profileId);
    if (!webview) return;
    try {
      await webview.executeJavaScript(buildInjectedComposerScript('install'), true);
      await webview.executeJavaScript(buildEnterTranslateScript(), true);
      if (!composerStatus.value[profileId]) setComposerStatus(profileId, '中文输入保护检测中');
    } catch {
      // The page may be navigating; the next loop will retry.
    }
  };
  void install();
  composerInstallIntervals.set(profileId, setInterval(() => void install(), 1500));
  composerEventPollIntervals.set(profileId, setInterval(() => void pollInjectedComposerEvents(profileId), 220));
}

function handleWebviewIpcMessage(event: Event, profile: ChatProfile) {
  const ipcEvent = event as CustomEvent<{ channel?: string; args?: unknown[] }>;
  if (ipcEvent.detail?.channel !== 'wc-composer') return;
  const payload = ipcEvent.detail.args?.[0] as { action?: string; text?: string } | undefined;
  if (!payload?.action) return;
  void handleInjectedComposerEvent(profile.id, payload.action, payload.text || '');
}

function startTranslationBridge(profileId: string) {
  if (translationIntervals.has(profileId)) return;
  const interval = setInterval(() => {
    void scanAndTranslateMessages(profileId);
  }, 3500);
  translationIntervals.set(profileId, interval);
}

async function scanAndTranslateMessages(profileId: string) {
  if (!window.chatTranslator) return;
  const profile = profiles.value.find((item) => item.id === profileId);
  if (!profile || appForPlatform(profile.platform) === 'signal') return;

  const webview = document.querySelector<Electron.WebviewTag>(`webview[data-profile-id="${profileId}"]`);
  if (!webview) return;

  let candidates: MessageCandidate[] = [];
  try {
    candidates = (await webview.executeJavaScript(buildMessageScanScript(appForPlatform(profile.platform)), true)) as MessageCandidate[];
  } catch {
    setComposerStatus(profileId, '消息扫描失败');
    return;
  }
  if (candidates.length) {
    setComposerStatus(profileId, `发现 ${candidates.length} 条英文消息，正在翻译`);
  }

  await preloadTranslationCache(profileId);
  await processManualMessageTranslations(profileId, webview);
  let loadedHistoryPageForScan = false;
  for (const candidate of candidates.slice(0, 6)) {
    const cacheKey = `${profileId}:${candidate.key}`;
    const sourceCacheKey = `${profileId}:${hashText(candidate.text)}`;
    if (translatedMessages.has(cacheKey) || translatingMessages.has(cacheKey)) continue;
    let cachedTranslation = getCachedTranslation(profileId, candidate.text, candidate);
    if (!cachedTranslation && !loadedHistoryPageForScan && !translationCacheExhausted.has(profileId)) {
      loadedHistoryPageForScan = true;
      await loadMoreTranslationCache(profileId);
      cachedTranslation = getCachedTranslation(profileId, candidate.text, candidate);
    }
    if (cachedTranslation) {
      await webview.executeJavaScript(buildMessageTranslationInjectScript(candidate.key, cachedTranslation, appForPlatform(profile.platform)), true);
      translatedMessages.add(cacheKey);
      translatedMessages.add(sourceCacheKey);
      continue;
    }
    translatingMessages.add(cacheKey);
    try {
      const translated = await window.chatTranslator.translate({ text: candidate.text, from: 'English', to: 'Chinese' });
      if (!translated) throw new Error('empty translation');
      await webview.executeJavaScript(buildMessageTranslationInjectScript(candidate.key, translated, appForPlatform(profile.platform)), true);
      setCachedTranslation(profile, candidate, translated);
      translatedMessages.add(cacheKey);
      translatedMessages.add(sourceCacheKey);
    } catch {
      setComposerStatus(profileId, '气泡翻译失败');
      // Keep the bridge quiet; the next scan can retry when the DOM or network is ready.
    } finally {
      translatingMessages.delete(cacheKey);
    }
  }
}

async function processManualMessageTranslations(profileId: string, webview: Electron.WebviewTag) {
  if (!window.chatTranslator) return;
  const profile = profiles.value.find((item) => item.id === profileId);
  if (!profile) return;
  let candidates: MessageCandidate[] = [];
  try {
    candidates = (await webview.executeJavaScript(
      `(() => { const q = window.__dfMessageTranslateQueue || []; window.__dfMessageTranslateQueue = []; return q; })()`,
      true
    )) as MessageCandidate[];
  } catch {
    return;
  }

  for (const candidate of candidates.slice(0, 3)) {
    const cacheKey = `${profileId}:${candidate.key}`;
    if (!candidate.text?.trim() || translatingMessages.has(cacheKey)) continue;
    translatingMessages.add(cacheKey);
    try {
      const translated = await window.chatTranslator.translate({ text: candidate.text, from: 'English', to: 'Chinese' });
      if (!translated) throw new Error('empty translation');
      await webview.executeJavaScript(buildMessageTranslationInjectScript(candidate.key, translated, appForPlatform(profile.platform)), true);
      setCachedTranslation(profile, candidate, translated);
      translatedMessages.add(cacheKey);
      translatedMessages.add(`${profileId}:${hashText(candidate.text)}`);
    } catch {
      setComposerStatus(profileId, '气泡翻译失败');
    } finally {
      translatingMessages.delete(cacheKey);
    }
  }
}

function buildMessageScanScript(app: RuntimeApp) {
  const platformApp = JSON.stringify(app);
  return `
(() => {
  const platformApp = ${platformApp};
  const hasChinese = (text) => /[\\u4e00-\\u9fff]/.test(text);
  const hasLatin = (text) => /[A-Za-z]{2,}/.test(text);
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 20 && rect.height > 12 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const isInViewport = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth;
  };
  const normalize = (text) => (text || '').replace(/\\s+/g, ' ').trim();
  const textWithoutTranslatorUi = (el) => {
    const clone = el.cloneNode(true);
    for (const node of Array.from(clone.querySelectorAll('.wc-message-refresh-translation, .wc-message-translation'))) {
      node.remove();
    }
    return clone.innerText || clone.textContent || '';
  };
  const stripBubbleTime = (text) => {
    let value = normalize(text);
    for (let i = 0; i < 4; i += 1) {
      const next = value
        .replace(/\\s*↻+\\s*$/u, '')
        .replace(/\\s*(?:[01]?\\d|2[0-3]):[0-5]\\d\\s*(?:AM|PM|am|pm)?\\s*(?:✓|✓✓|✔|✔✔|↻)*\\s*$/u, '')
        .trim();
      if (next === value) break;
      value = next;
    }
    return value;
  };
  const cleanMessageText = (text) => {
    let value = normalize(text).replace(/\\s*(?:↻+|\\.\\.\\.)\\s*$/u, '').trim();
    value = stripBubbleTime(value);
    value = value.replace(/\\s*(?:↻+|\\.\\.\\.)\\s*$/u, '').trim();
    return stripBubbleTime(value);
  };
  const reject = (el) => Boolean(el.closest('footer, header, nav, aside, [role="textbox"], [contenteditable="true"], [data-testid="author"], [testid="author"], .wc-composer-host, .wc-message-translation'));
  const findBubble = (el) => platformApp === 'telegram'
    ? (
      el.closest('.bubble-content-wrapper') ||
      el.closest('.bubble-content') ||
      el.closest('.Message')
    )
    : el.closest('[data-testid="msg-container"], [data-pre-plain-text], [role="row"], [data-id^="true_"], [data-id^="false_"], .message-in, .message-out, .Message');
  const quoteSelector = [
    '[data-testid="quoted-message"]',
    '[data-testid*="quoted"]',
    '[data-testid*="reply"]',
    '[aria-label*="Quoted"]',
    '[aria-label*="Reply"]',
    '.reply.quote-like',
    '.reply-subtitle',
    '.quoted-message',
    '.quoted',
    '.reply',
    '.MessageReply',
    '[class*="quoted"]',
    '[class*="reply"]'
  ].join(',');
  const findQuoteBlock = (el) =>
    el.closest('[data-testid="quoted-message"]') ||
    el.closest('.reply.quote-like') ||
    el.closest(quoteSelector);
  const hashKey = (text) => {
    let hash = 2166136261;
    for (const char of normalize(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  };
  const normalizePhone = (text) => {
    const match = normalize(text).match(/(?:\\+|00)?\\d[\\d\\s().-]{6,}\\d/);
    if (!match) return '';
    const raw = match[0].trim();
    const plus = raw.startsWith('+');
    const digits = raw.replace(/\\D/g, '');
    if (digits.length < 7) return '';
    return plus ? '+' + digits : digits;
  };
  const readContactMeta = () => {
    const titleSelectors = [
      'header [title]',
      'header [dir="auto"]',
      '.chat-info .title',
      '.ChatInfo .title',
      '[class*="ChatInfo"] [dir="auto"]',
      '[class*="top"] [dir="auto"]'
    ];
    const titleParts = [];
    for (const selector of titleSelectors) {
      for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 6)) {
        const value = normalize(el.getAttribute('title') || el.textContent || '');
        if (value && !titleParts.includes(value)) titleParts.push(value);
      }
    }
    const contactTitle = titleParts[0] || document.title || 'unknown-contact';
    const phone = normalizePhone(titleParts.join(' ') + ' ' + document.body.innerText.slice(0, 800));
    const contactIdType = phone ? 'phone' : (contactTitle ? 'title' : 'unknown');
    const contactId = phone || hashKey(contactTitle || location.href || 'unknown-contact');
    return {
      contactId,
      contactIdType,
      contactTitle,
      contactRemark: contactTitle,
      contactKey: contactIdType + '-' + contactId
    };
  };
  const readDirection = (bubble) => {
    const marker = (bubble.getAttribute('data-id') || bubble.className || '').toString();
    if (marker.includes('message-out') || marker.startsWith('true_') || /\\bown\\b|outgoing|is-out/.test(marker)) return 'outgoing';
    if (marker.includes('message-in') || marker.startsWith('false_') || /incoming|is-in/.test(marker)) return 'incoming';
    const rect = bubble.getBoundingClientRect();
    if (rect.width > 0) return rect.left + rect.width / 2 > window.innerWidth / 2 ? 'outgoing' : 'incoming';
    return 'unknown';
  };
  const readTimestamp = (bubble) => {
    const text = normalize(bubble.innerText || bubble.textContent || '');
    const match = text.match(/(?:[01]?\\d|2[0-3]):[0-5]\\d\\s*(?:AM|PM|am|pm)?/);
    return match ? match[0] : '';
  };
  const ensureRefreshButton = (bubble, textNode, key, text, messagePart) => {
    const telegramBubbleContent = platformApp === 'telegram'
      ? (textNode.closest('.bubble-content') || (bubble.matches?.('.bubble-content') ? bubble : bubble.querySelector('.bubble-content')))
      : null;
    const direction = readDirection(bubble);
    const mount = platformApp === 'telegram'
      ? direction === 'incoming'
        ? (telegramBubbleContent || textNode.closest('.message.spoilers-container, .message') || bubble)
        : (
          telegramBubbleContent?.querySelector('.message.spoilers-container, .message') ||
          textNode.closest('.message.spoilers-container, .message') ||
          telegramBubbleContent ||
          bubble
      )
      : bubble;
    if (platformApp === 'telegram') {
      const cleanupScope = textNode.closest('[role="row"]') || bubble;
      for (const oldButton of Array.from(cleanupScope.querySelectorAll('.wc-message-refresh-translation'))) {
        if (!mount.contains(oldButton)) oldButton.remove();
      }
    }
    if (mount.querySelector('.wc-message-refresh-translation')) return;
    if (window.getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wc-message-refresh-translation';
    button.dataset.dfRefreshKey = key;
    button.dataset.dfMessagePart = 'bubble';
    button.title = '重新翻译本条气泡';
    button.innerHTML = '&#8635;';
    button.style.cssText = [
      'position:absolute',
      'right:3px',
      'bottom:3px',
      'z-index:20',
      'width:20px',
      'height:20px',
      'border-radius:50%',
      'border:1px solid rgba(214,174,58,0.42)',
      'background:rgba(255,244,179,0.74)',
      'color:#8a6500',
      'font-size:13px',
      'line-height:18px',
      'padding:0',
      'cursor:pointer',
      'box-shadow:none',
      'appearance:none'
    ].join(';');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const meta = readContactMeta();
      window.__dfMessageTranslateQueue = Array.isArray(window.__dfMessageTranslateQueue) ? window.__dfMessageTranslateQueue : [];
      const queuedKeys = new Set();
      const keyedTextNodes = Array.from(bubble.querySelectorAll('[data-wc-msg-text-key]'));
      const candidates = keyedTextNodes.length ? keyedTextNodes : [textNode];
      for (const node of candidates) {
        const candidateKey = node.dataset.dfMsgTextKey || key;
        if (!candidateKey || queuedKeys.has(candidateKey)) continue;
        const candidateText = cleanMessageText(textWithoutTranslatorUi(node));
        if (!candidateText || !hasLatin(candidateText) || hasChinese(candidateText)) continue;
        queuedKeys.add(candidateKey);
        window.__dfMessageTranslateQueue.push({
          key: candidateKey,
          text: candidateText,
          ...meta,
          direction: readDirection(bubble),
          timestamp: readTimestamp(bubble),
          messagePart: findQuoteBlock(node) ? 'quote' : 'body',
          at: Date.now()
        });
      }
      if (!queuedKeys.size) {
        window.__dfMessageTranslateQueue.push({
          key,
          text,
          ...meta,
          direction: readDirection(bubble),
          timestamp: readTimestamp(bubble),
          messagePart,
          at: Date.now()
        });
      }
      button.textContent = '...';
      window.setTimeout(() => { if (button.isConnected) button.innerHTML = '&#8635;'; }, 1600);
    }, true);
    mount.appendChild(button);
  };
  const textSelectors = platformApp === 'telegram'
    ? [
      '.bubble-content .reply.quote-like .reply-subtitle',
      '.reply.quote-like .reply-subtitle',
      '.bubble-content > .message.spoilers-container',
      '.bubble-content > .message',
      '.text-content',
      '.translatable-message',
      '.Message .text-content',
      '.message .text-content'
    ]
    : [
      '[data-testid="quoted-message"] .quoted-mention.selectable-text',
      '[data-testid="quoted-message"] [data-testid="selectable-text"].quoted-mention',
      '.selectable-text.copyable-text',
      '[data-pre-plain-text] .selectable-text',
      '[data-testid="msg-container"] .selectable-text',
      '.message-in .selectable-text',
      '.message-out .selectable-text',
      '.translatable-message',
      '.text-content'
    ];
  const textNodes = [];
  for (const selector of textSelectors) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (isVisible(el) && isInViewport(el) && !reject(el) && !textNodes.includes(el)) textNodes.push(el);
    }
  }
  const directResults = [];
  const contactMeta = readContactMeta();
  const visibleTextNodes = textNodes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const scannedParts = new Set();
  for (const textNode of visibleTextNodes) {
    const bubble = findBubble(textNode);
    if (!bubble) continue;
    const quoteBlock = findQuoteBlock(textNode);
    const messagePart = quoteBlock ? 'quote' : 'body';
    const text = cleanMessageText(textWithoutTranslatorUi(textNode));
    if (!text || text.length < 2 || text.length > 4000) continue;
    if (!hasLatin(text) || hasChinese(text)) continue;
    if (/typing|online|last seen|search|message|emoji|voice|Workspace Core|工作区核心/i.test(text)) continue;
    if (!bubble.dataset.wcMsgKey) {
      bubble.dataset.wcMsgKey = 'wc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }
    const targetKey = messagePart === 'quote' ? bubble.dataset.wcMsgKey + '-quote-' + hashKey(text) : bubble.dataset.wcMsgKey;
    if (scannedParts.has(targetKey)) continue;
    scannedParts.add(targetKey);
    if (quoteBlock) quoteBlock.dataset.wcMsgKey = targetKey;
    textNode.dataset.dfMsgTextKey = targetKey;
    ensureRefreshButton(bubble, textNode, targetKey, text, messagePart);
    const translationMount = platformApp === 'telegram'
      ? (
        quoteBlock
          ? (quoteBlock.querySelector('.reply-content') || quoteBlock)
          : (
            textNode.closest('.message.spoilers-container, .message') ||
            textNode.closest('.bubble-content') ||
            textNode
          )
      )
      : (
        quoteBlock ||
        textNode.closest('[data-testid="selectable-text"], .selectable-text.copyable-text, .translatable-message, .text-content, [class*="text-content"]') ||
        textNode
      );
    if (translationMount.querySelector('.wc-message-translation')) continue;
    directResults.push({
      key: targetKey,
      text,
      ...contactMeta,
      direction: readDirection(bubble),
      timestamp: readTimestamp(bubble),
      messagePart
    });
    if (directResults.length >= 12) break;
  }
  return directResults;
  const selectors = [
    '[data-id^="true_"], [data-id^="false_"]',
    '[data-pre-plain-text]',
    '[role="row"]',
    '[data-testid*="msg"]',
    '.message-in, .message-out',
    '.bubble, .bubble-content, .Message, .message',
    '.text-content, .translatable-message',
    '.Message, .message',
    '[class*="message"]'
  ];
  const containers = [];
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (isVisible(el) && !containers.includes(el)) containers.push(el);
    }
  }
  const recent = containers.slice(-30);
  const results = [];
  for (const container of recent) {
    if (container.querySelector('.wc-message-translation')) continue;
    const textNode =
      container.querySelector('.selectable-text.copyable-text') ||
      container.querySelector('[data-pre-plain-text]') ||
      container.querySelector('[class*="text"]') ||
      container.querySelector('[dir="auto"]') ||
      container.querySelector('.text-content') ||
      container.querySelector('.translatable-message') ||
      container;
    const text = normalize(textNode?.innerText || textNode?.textContent || '');
    if (!text || text.length < 2 || text.length > 900) continue;
    if (text.length > 220 && container.children.length > 6) continue;
    if (!hasLatin(text) || hasChinese(text)) continue;
    if (/正在输入中文|回车后即可发送英文/.test(text)) continue;
    if (!container.dataset.wcMsgKey) {
      container.dataset.wcMsgKey = 'wc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }
    textNode.dataset.dfMsgTextKey = container.dataset.wcMsgKey;
    results.push({ key: container.dataset.wcMsgKey, text });
    if (results.length >= 8) break;
  }
  return results;
})()
`;
}

function buildMessageTranslationInjectScript(key: string, translation: string, app: RuntimeApp) {
  const payload = JSON.stringify({ key, translation, app });
  return `
(() => {
  const payload = ${payload};
  const quoteSelector = [
    '[data-testid="quoted-message"]',
    '[data-testid*="quoted"]',
    '[data-testid*="reply"]',
    '[aria-label*="Quoted"]',
    '[aria-label*="Reply"]',
    '.reply.quote-like',
    '.reply-subtitle',
    '.quoted-message',
    '.quoted',
    '.reply',
    '.MessageReply',
    '[class*="quoted"]',
    '[class*="reply"]'
  ].join(',');
  const targetByKey = document.querySelector('[data-wc-msg-text-key="' + payload.key + '"]');
  const keyedContainer = document.querySelector('[data-wc-msg-key="' + payload.key + '"]');
  const container =
    keyedContainer ||
    targetByKey?.closest('[data-testid="msg-container"], [data-pre-plain-text], [role="row"], [data-id^="true_"], [data-id^="false_"], .message-in, .message-out, .Message');
  if (!container) return false;
  const telegramQuoteBlock = payload.app === 'telegram'
    ? (targetByKey?.closest('.reply.quote-like') || (keyedContainer && keyedContainer.matches('.reply.quote-like') ? keyedContainer : null))
    : null;
  const quoteMount = payload.app === 'telegram'
    ? (
      telegramQuoteBlock?.querySelector('.reply-content') ||
      telegramQuoteBlock
    )
    : (
      targetByKey?.closest('[data-testid="quoted-message"]') ||
      targetByKey?.closest(quoteSelector) ||
      (keyedContainer && keyedContainer.matches(quoteSelector) ? keyedContainer : null)
    );
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 10 && rect.height > 8 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const target =
    targetByKey ||
    container.querySelector('.selectable-text.copyable-text') ||
    container.querySelector('.translatable-message') ||
    container.querySelector('.text-content') ||
    Array.from(container.querySelectorAll('[dir="auto"], span, div')).filter(isVisible).pop() ||
    container;
  const textMount =
    payload.app === 'telegram'
      ? (
        target.closest('.message.spoilers-container, .message') ||
        target.closest('.bubble-content') ||
        target.parentElement ||
        target
      )
      : (
        target.closest('[data-testid="selectable-text"], .selectable-text.copyable-text, .translatable-message, .text-content, [class*="text-content"]') ||
        target
      );
  const mount = quoteMount || textMount;
  if (mount.querySelector('.wc-message-translation')) return false;
  const node = document.createElement('div');
  node.className = 'wc-message-translation';
  node.textContent = payload.translation;
  node.style.cssText = [
    'display:block',
    'margin-top:5px',
    'border-top:1px solid rgba(120,120,120,0.18)',
    'padding-top:5px',
    'color:#166534',
    'font-size:13px',
    'line-height:1.45',
    'white-space:pre-wrap',
    'word-break:break-word',
    'max-width:100%',
    'box-sizing:border-box'
  ].join(';');
  mount.appendChild(node);
  return true;
})()
`;
}

function buildFingerprintScript(profile: ChatProfile) {
  const fp = JSON.stringify(profile.fingerprint);
  return `
(() => {
  const fp = ${fp};
  const defineGetter = (target, key, value) => {
    try {
      Object.defineProperty(target, key, { configurable: true, get: () => value });
    } catch {}
  };

  if (fp.hardwareSource === 'custom') {
    defineGetter(Navigator.prototype, 'hardwareConcurrency', fp.hardwareConcurrency);
    defineGetter(Navigator.prototype, 'deviceMemory', fp.deviceMemory);
  }

  if (fp.languageSource === 'custom' && fp.languages && fp.languages.length) {
    defineGetter(Navigator.prototype, 'languages', fp.languages);
    defineGetter(Navigator.prototype, 'language', fp.languages[0]);
  }

  if (fp.timezoneSource === 'custom' && fp.timezone) {
    const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions() {
      return { ...originalResolvedOptions.call(this), timeZone: fp.timezone };
    };
  }

  const patchWebGL = (Ctor) => {
    if (!Ctor || !Ctor.prototype) return;
    const originalGetParameter = Ctor.prototype.getParameter;
    Ctor.prototype.getParameter = function getParameter(parameter) {
      if (parameter === 37445) return fp.webglVendor;
      if (parameter === 37446) return fp.webglRenderer;
      return originalGetParameter.call(this, parameter);
    };
  };

  patchWebGL(window.WebGLRenderingContext);
  patchWebGL(window.WebGL2RenderingContext);

  const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function toDataURL(...args) {
    const context = this.getContext('2d');
    if (context) {
      const x = fp.canvasSeed % Math.max(1, this.width || 1);
      const y = fp.canvasSeed % Math.max(1, this.height || 1);
      context.fillStyle = 'rgba(' + (fp.canvasSeed % 255) + ',1,1,0.01)';
      context.fillRect(x, y, 1, 1);
    }
    return originalToDataURL.apply(this, args);
  };
})();
`;
}

onMounted(() => {
  void loadRuntimeState();
});
</script>

<template>
  <main v-if="!signedIn" class="page login-page" :class="themeClass">
    <div class="window-ctrl vertical" @pointerdown.stop @mousedown.stop>
      <button type="button" aria-label="minimize" data-window-control="minimize" @click.stop="minimizeWindow">-</button>
      <button type="button" aria-label="maximize" data-window-control="toggle-maximize" @click.stop="toggleMaximizeWindow">□</button>
      <button type="button" aria-label="close" data-window-control="close" @click.stop="closeWindow">×</button>
    </div>

    <section class="login-brand">
      <div class="brand-mark large"></div>
      <div class="brand-kicker">WORKSPACE CORE</div>
      <h1>工作区核心</h1>
      <p>多账号聊天翻译 / 多平台会话管理 / 本地数据隔离</p>
    </section>

    <section class="login-workbench">
      <div class="login-card">
        <h2>登录工作台</h2>
        <p>Workspace Core v0.1</p>

        <label class="form-row stacked">
          <span>账号</span>
          <input placeholder="user@example.local" />
        </label>

        <label class="form-row stacked">
          <span>密码</span>
          <input placeholder="请输入密码" type="password" value="12345678" />
        </label>

        <div class="login-options">
          <label class="save-me">
            <input v-model="rememberPassword" type="checkbox" />
            <span>记住登录状态</span>
          </label>
          <button class="btn forget-pwd" type="button">忘记密码</button>
        </div>

        <button class="login" type="button" @click="login">进入工作台</button>

        <div class="login-meta">
          <span>可用字符 128,430</span>
          <span>WhatsApp / Telegram</span>
        </div>
      </div>
    </section>
  </main>

  <main v-show="signedIn && activePanel !== 'session'" class="page app-page" :class="themeClass">
    <div class="window-ctrl vertical" @pointerdown.stop @mousedown.stop>
      <button type="button" data-window-control="minimize" @click.stop="minimizeWindow">-</button>
      <button type="button" data-window-control="toggle-maximize" @click.stop="toggleMaximizeWindow">□</button>
      <button type="button" data-window-control="close" @click.stop="closeWindow">×</button>
    </div>

    <aside class="app-sidebar">
      <div class="brand-mark"></div>
      <h2>工作区核心</h2>
      <span>v0.1.0</span>

      <nav class="side-nav">
        <button :class="{ active: activePanel === 'apps' }" type="button" @click="activePanel = 'apps'"><b>⌂</b>主页</button>
        <button :class="{ active: activePanel === 'home' }" type="button" @click="activePanel = 'home'"><b>02</b>我的主页</button>
        <button :class="{ active: activePanel === 'notice' }" type="button" @click="activePanel = 'notice'"><b>03</b>管理通知</button>
        <button :class="{ active: activePanel === 'agency' }" type="button" @click="activePanel = 'agency'"><b>04</b>代理加盟</button>
      </nav>

      <div class="sidebar-status">客户资产保护已启用</div>
    </aside>

    <section class="app-main">
      <header class="top-actions">
        <button type="button">锁屏</button>
        <button type="button">一键重启</button>
        <div class="theme-picker">
          <button type="button" @click="themeMenuOpen = !themeMenuOpen">更换主题</button>
          <div v-if="themeMenuOpen" class="theme-menu">
            <button :class="{ active: activeTheme === 'light' }" type="button" @click="setTheme('light')">浅色</button>
            <button :class="{ active: activeTheme === 'dark' }" type="button" @click="setTheme('dark')">深色</button>
          </div>
        </div>
        <button :class="{ active: activePanel === 'settings' }" type="button" @click="activePanel = 'settings'">设置</button>
        <button :class="{ active: activePanel === 'account' }" type="button" @click="activePanel = 'account'">个人中心</button>
      </header>

      <section v-if="activePanel === 'apps'" class="content-panel app-center">
        <div class="section-title">
          <span>APPLICATIONS</span>
          <h1>主页</h1>
        </div>

        <div class="app-card-row">
          <button v-for="tile in appTiles" :key="tile.app" class="launch-card" type="button" :disabled="isCreatingProfile" @click="selectRuntimeApp(tile.app)">
            <span class="app-logo text-logo">{{ tile.short }}</span>
            <strong>{{ tile.label }}</strong>
          </button>
        </div>
      </section>

      <section v-else class="content-panel settings-page compact">
        <div class="section-title">
          <span>{{ activePanel === 'settings' ? 'SETTINGS' : activePanel === 'account' ? 'ACCOUNT' : 'DASHBOARD' }}</span>
          <h1>{{ activePanel === 'settings' ? '全局设置' : activePanel === 'account' ? '个人中心' : '我的主页' }}</h1>
        </div>

        <div class="setting-card">
          <label><span>本软件语言</span><select><option>系统语言</option><option>简体中文</option></select></label>
          <label><span>客户端显示</span><select><option>任务栏和系统托盘显示</option></select></label>
          <label><span>应用窗口标签排版</span><select><option>顶部横排</option><option>左侧竖排</option></select></label>
          <label><span>窗口模式</span><select><option>嵌入</option><option>独立</option></select></label>
        </div>
      </section>
    </section>

    <aside class="quick-rail">
      <button type="button">通知</button>
      <button type="button">充值</button>
      <button type="button">官网</button>
      <button type="button">公告</button>
    </aside>
  </main>

  <main v-show="signedIn && activePanel === 'session'" class="page workspace-page" :class="themeClass">
    <header class="runtime-header">
      <div class="runtime-brand">
        <div class="brand-mark small"></div>
        <strong>工作区核心</strong>
        <span>Workspace Core v0.1.0</span>
      </div>
      <nav>
        <button type="button">勿扰已关闭</button>
        <button type="button">锁屏</button>
        <button type="button">重启软件</button>
        <div class="theme-picker">
          <button type="button" @click="themeMenuOpen = !themeMenuOpen">更换主题</button>
          <div v-if="themeMenuOpen" class="theme-menu">
            <button :class="{ active: activeTheme === 'light' }" type="button" @click="setTheme('light')">浅色</button>
            <button :class="{ active: activeTheme === 'dark' }" type="button" @click="setTheme('dark')">深色</button>
          </div>
        </div>
      </nav>
    </header>

    <aside class="runtime-side">
      <button type="button" class="runtime-home" @click="activePanel = 'apps'"><span>⌂</span>主页</button>
      <button type="button" class="app-short wa" :class="{ active: currentApp === 'whatsapp' }" @click="selectRuntimeApp('whatsapp')">
        <span class="text-logo">WA</span>
      </button>
      <button type="button" class="app-short tg" :class="{ active: currentApp === 'telegram' }" @click="selectRuntimeApp('telegram')">
        <span class="text-logo">TG</span>
      </button>
      <button type="button" class="app-short sg" :class="{ active: currentApp === 'signal' }" @click="selectRuntimeApp('signal')">
        <span class="text-logo">SG</span>
      </button>
    </aside>

    <div class="window-ctrl vertical" @pointerdown.stop @mousedown.stop>
      <button type="button" data-window-control="minimize" @click.stop="minimizeWindow">-</button>
      <button type="button" data-window-control="toggle-maximize" @click.stop="toggleMaximizeWindow">□</button>
      <button type="button" data-window-control="close" @click.stop="closeWindow">×</button>
    </div>

    <section class="multi-open-tabs">
      <div class="multi-open-list">
        <template v-for="(tab, index) in workspaceTabs" :key="tab.id">
          <span v-if="index > 0" class="multi-open-separator">|</span>
          <button
            class="runtime-tab"
            :class="{ active: activeProfileId === tab.id }"
            type="button"
            draggable="true"
            @click="selectRuntimeTab(tab.id)"
            @dragstart="handleTabDragStart(tab.id)"
            @dragover.prevent
            @drop.prevent="handleTabDrop(tab.id)"
          >
            <span class="tab-icon text-logo">{{ tab.short }}</span>
            <b>{{ tab.name }}</b>
            <em aria-label="rename" title="修改自定义名称" @click.stop="requestRenameProfile(tab)">✎</em>
            <i aria-label="close" @click.stop="requestCloseProfile(tab)">×</i>
          </button>
        </template>
        <button class="add-tab" type="button" :disabled="isCreatingProfile" @click="openCreateProfileDialog">+</button>
      </div>
    </section>

    <section class="runtime-web-main">
      <webview
        v-for="item in renderableProfiles"
        ref="webviewRef"
        :key="item.profile.id"
        class="platform-webview"
        :class="{ active: activeProfileId === item.profile.id && !createDialogOpen && !closeTargetProfile && !renameTargetProfile }"
        :data-profile-id="item.profile.id"
        :src="item.url"
        :partition="item.profile.partition"
        :useragent="item.profile.fingerprint.userAgent"
        allowpopups
        @dom-ready="(event: Event) => handleWebviewDomReady(event, item.profile)"
        @ipc-message="(event: Event) => handleWebviewIpcMessage(event, item.profile)"
      />

      <div v-if="!hasActiveRenderableProfile" class="session-empty">
        <p>{{ currentAppTile.label }} 未打开多开环境</p>
        <span>点击顶部 +，填写自定义名称后创建当前应用的多开。</span>
        <button type="button" @click="openCreateProfileDialog">新建多开</button>
      </div>
    </section>

    <div v-if="createDialogOpen" class="modal-mask" @click.self="createDialogOpen = false">
      <section class="modal-card">
        <h3>新建 {{ currentAppTile.label }} 多开</h3>
        <label>
          <span>自定义名称</span>
          <input v-model="newProfileName" autofocus placeholder="例如 WS01" @keyup.enter="confirmCreateProfile" />
        </label>
        <p v-if="createProfileError" class="modal-error">{{ createProfileError }}</p>
        <div class="modal-actions">
          <button type="button" @click="createDialogOpen = false">取消</button>
          <button type="button" :disabled="isCreatingProfile" @click.stop="confirmCreateProfile">
            {{ isCreatingProfile ? '创建中' : '确定' }}
          </button>
        </div>
      </section>
    </div>

    <div v-if="closeTargetProfile" class="modal-mask" @click.self="closeTargetProfile = null">
      <section class="modal-card">
        <h3>关闭多开</h3>
        <p>是否关闭“{{ closeTargetProfile.name }}”的窗口？</p>
        <div class="modal-actions">
          <button type="button" @click="closeTargetProfile = null">否</button>
          <button type="button" @click="confirmCloseProfile">是</button>
        </div>
      </section>
    </div>

    <div v-if="renameTargetProfile" class="modal-mask" @click.self="renameTargetProfile = null">
      <section class="modal-card">
        <h3>修改自定义名称</h3>
        <label>
          <span>自定义名称</span>
          <input v-model="renameProfileName" autofocus placeholder="例如 WS01" @keyup.enter="confirmRenameProfile" />
        </label>
        <p v-if="renameProfileError" class="modal-error">{{ renameProfileError }}</p>
        <div class="modal-actions">
          <button type="button" @click="renameTargetProfile = null">取消</button>
          <button type="button" :disabled="isRenamingProfile" @click.stop="confirmRenameProfile">
            {{ isRenamingProfile ? '保存中' : '确定' }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>




