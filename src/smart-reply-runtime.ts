import type { WorkspaceApp } from '../electron/shared';

export type SmartReplyUiSuggestion = {
  id: 'reply_1' | 'reply_2' | 'reply_3';
  english: string;
  chinese: string;
};

type SmartReplyUiStatePayload = {
  latestMessageKey: string;
  conversationSignature: string;
  state: 'loading' | 'success' | 'error' | 'clear';
  message?: string;
  replies?: SmartReplyUiSuggestion[];
};

export function buildSmartReplyUiInstallScript(app: WorkspaceApp) {
  const platform = JSON.stringify(app);
  return `
(() => {
  const platform = ${platform};
  if (platform === 'signal') return false;
  const uiSelector = '.df-smart-reply-host, .df-smart-reply-panel';
  const normalize = (value) => String(value || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
  const hasEnglish = (value) => /[A-Za-z]{2,}/.test(value || '');
  const hasChinese = (value) => /[\\u4e00-\\u9fff]/.test(value || '');
  const isRendered = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return rect.width > 10 && rect.height > 8 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const findScrollParent = (element) => {
    let current = element?.parentElement;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      if (/(auto|scroll)/.test(style.overflowY || '') && current.scrollHeight > current.clientHeight + 40) return current;
      current = current.parentElement;
    }
    return null;
  };
  const isNearConversationEnd = (element) => {
    const scroller = findScrollParent(element);
    if (!scroller) return true;
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    return remaining <= Math.max(160, scroller.clientHeight * 0.18);
  };
  const hash = (value) => {
    let result = 2166136261;
    for (const character of String(value || '')) {
      result ^= character.charCodeAt(0);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  };
  const isListArea = (element) => Boolean(element?.closest?.([
    '#pane-side', '[data-testid="chat-list"]', '[data-testid="cell-frame-container"]',
    '.chat-list', '.dialogs-list', '.DialogList', '.ListItem',
    '[class*="ChatList"]', '[class*="chatlist"]', '[class*="dialog-list"]'
  ].join(',')));
  const exactDirection = (bubble) => {
    let current = bubble;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      const dataId = String(current.getAttribute?.('data-id') || '');
      const marker = [
        dataId,
        current.getAttribute?.('data-testid') || '',
        current.getAttribute?.('data-message-author') || '',
        current.className || ''
      ].join(' ').toLowerCase();
      if (dataId.startsWith('true_') || /(?:^|[\\s_-])(?:message-out|own|outgoing|is-out|from-me)(?:$|[\\s_-])/.test(marker)) return 'outgoing';
      if (dataId.startsWith('false_') || /(?:^|[\\s_-])(?:message-in|incoming|is-in|from-them|received)(?:$|[\\s_-])/.test(marker)) return 'incoming';
    }
    return 'unknown';
  };
  const canonicalBubble = (element) => {
    if (!element) return null;
    if (platform === 'telegram') {
      return element.closest?.('.bubble[data-mid], .bubble, .Message') || null;
    }
    return element.closest?.('[data-id^="true_"], [data-id^="false_"]') ||
      element.closest?.('.message-in, .message-out') ||
      element.closest?.('[data-testid="msg-container"]') ||
      element.closest?.('[data-pre-plain-text]') ||
      null;
  };
  const bubbleSelector = platform === 'telegram'
    ? '.bubble[data-mid], .bubble, .Message'
    : '[data-id^="true_"], [data-id^="false_"], [data-testid="msg-container"], [data-pre-plain-text], .message-in, .message-out';
  const textSelector = platform === 'telegram'
    ? '.bubble-content > .message.spoilers-container > .translatable-message, .bubble-content > .message > .translatable-message, .bubble-content > .message.spoilers-container, .bubble-content > .message, .Message .text-content, .text-content, .translatable-message'
    : '[data-pre-plain-text] .selectable-text.copyable-text, [data-pre-plain-text] .selectable-text, [data-testid="msg-container"] [data-testid="selectable-text"], [data-testid="msg-container"] .selectable-text.copyable-text, [data-testid="msg-container"] .selectable-text, .message-in .selectable-text, .message-out .selectable-text';
  const uniqueBubbles = [];
  const seen = new Set();
  for (const element of Array.from(document.querySelectorAll(bubbleSelector))) {
    const bubble = canonicalBubble(element);
    if (!bubble || seen.has(bubble) || isListArea(bubble) || !isRendered(bubble)) continue;
    if (bubble.closest?.('header, footer, nav, aside, [role="dialog"], [role="menu"]')) continue;
    seen.add(bubble);
    uniqueBubbles.push(bubble);
  }
  const extractText = (bubble) => {
    const source = Array.from(bubble.querySelectorAll?.(textSelector) || []).find((node) => !node.closest?.([
      '[data-testid="quoted-message"]', '[data-testid*="quoted"]', '[data-testid*="reply"]',
      '.reply.quote-like', '.reply-subtitle', '.quoted-message', '.quoted', '.MessageReply',
      '.df-chat-translation', '.df-smart-reply-host', '.df-smart-reply-panel'
    ].join(',')));
    if (!source) return '';
    const clone = source.cloneNode(true);
    for (const node of Array.from(clone.querySelectorAll([
      '.df-chat-translation', '.df-chat-refresh-translation', '.df-smart-reply-host', '.df-smart-reply-panel',
      '[data-testid="quoted-message"]', '[data-testid*="quoted"]', '[data-testid*="reply"]',
      '.reply.quote-like', '.reply-subtitle', '.quoted-message', '.quoted', '.MessageReply',
      '.time', '.time-inner', '.tgico', '.i18n'
    ].join(',')))) node.remove();
    let value = normalize(clone.innerText || clone.textContent || '');
    value = value
      .replace(/\\s*(?:[01]?\\d|2[0-3]):[0-5]\\d\\s*(?:AM|PM|am|pm)?\\s*(?:✓|✓✓|✔|✔✔|↻)*\\s*$/u, '')
      .replace(/\\s*↻+\\s*$/u, '')
      .trim();
    return value;
  };
  const bubbleKey = (bubble, text) => {
    if (!bubble.dataset.dfSmartReplyKey) {
      const stable = [
        bubble.getAttribute?.('data-id') || '',
        bubble.getAttribute?.('data-mid') || '',
        bubble.getAttribute?.('data-pre-plain-text') || '',
        text
      ].join('|');
      bubble.dataset.dfSmartReplyKey = 'smart-' + hash(stable) + '-' + hash(text);
    }
    return bubble.dataset.dfSmartReplyKey;
  };
  const rows = uniqueBubbles.map((bubble) => {
    const text = extractText(bubble);
    return {
      bubble,
      text,
      direction: exactDirection(bubble),
      key: bubbleKey(bubble, text)
    };
  });
  const removeAll = () => {
    for (const node of Array.from(document.querySelectorAll(uiSelector))) node.remove();
  };
  const latest = rows.at(-1);
  if (!latest || !isNearConversationEnd(latest.bubble) || latest.direction !== 'incoming' || !latest.text || latest.text.length > 4000 || !hasEnglish(latest.text) || hasChinese(latest.text)) {
    removeAll();
    return false;
  }
  const context = rows
    .filter((row) =>
      (row.direction === 'incoming' || row.direction === 'outgoing') &&
      row.text && row.text.length <= 4000 && hasEnglish(row.text) && !hasChinese(row.text)
    )
    .slice(-8)
    .map((row, index) => ({
      seq: index + 1,
      speaker: row.direction === 'incoming' ? 'other' : 'self',
      text: row.text
    }));
  if (!context.length || context.at(-1)?.speaker !== 'other' || context.at(-1)?.text !== latest.text) {
    removeAll();
    return false;
  }
  let totalLength = context.reduce((sum, item) => sum + item.text.length, 0);
  while (context.length > 1 && totalLength > 8000) {
    const removed = context.shift();
    totalLength -= removed?.text.length || 0;
  }
  context.forEach((item, index) => { item.seq = index + 1; });
  if (totalLength > 8000) {
    removeAll();
    return false;
  }
  for (const host of Array.from(document.querySelectorAll('.df-smart-reply-host'))) {
    if (!latest.bubble.contains(host)) host.remove();
  }
  for (const panel of Array.from(document.querySelectorAll('.df-smart-reply-panel'))) {
    if (!latest.bubble.contains(panel)) panel.remove();
  }
  let host = latest.bubble.querySelector('.df-smart-reply-host');
  if (!host) {
    host = document.createElement('span');
    host.className = 'df-smart-reply-host';
    host.style.cssText = 'display:inline-flex;align-items:center;margin-left:7px;vertical-align:middle;white-space:nowrap';
    const mount = latest.bubble.querySelector('.df-chat-translation') || latest.bubble.querySelector(textSelector) || latest.bubble;
    mount.appendChild(host);
  }
  host.dataset.dfSmartReplyKey = latest.key;
  host.dataset.dfSmartReplyConversation = String(window.__dfConversationSignature || '');
  let button = host.querySelector('.df-smart-reply-button');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'df-smart-reply-button';
    button.textContent = '智能回复';
    button.title = '根据最近最多 8 条英文气泡生成 3 组中英对照回复';
    button.style.cssText = [
      'appearance:none', 'border:1px solid currentColor', 'border-radius:999px', 'background:transparent',
      'color:inherit', 'cursor:pointer', 'display:inline-flex', 'align-items:center', 'justify-content:center',
      'font:600 12px/1.2 inherit', 'min-height:24px', 'padding:3px 9px', 'opacity:.82', 'white-space:nowrap'
    ].join(';');
    host.appendChild(button);
  }
  if (button.dataset.dfSmartReplyBound !== '1') {
    button.dataset.dfSmartReplyBound = '1';
    const trigger = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (button.disabled) return;
      const liveRows = uniqueBubbles.map((bubble) => ({
        bubble,
        text: extractText(bubble),
        direction: exactDirection(bubble),
        key: bubbleKey(bubble, extractText(bubble))
      }));
      const liveLatest = liveRows.at(-1);
      if (!liveLatest || liveLatest.key !== latest.key || liveLatest.direction !== 'incoming') return;
      const liveContext = liveRows
        .filter((row) =>
          (row.direction === 'incoming' || row.direction === 'outgoing') &&
          row.text && row.text.length <= 4000 && hasEnglish(row.text) && !hasChinese(row.text)
        )
        .slice(-8)
        .map((row, index) => ({
          seq: index + 1,
          speaker: row.direction === 'incoming' ? 'other' : 'self',
          text: row.text
        }));
      let liveTotal = liveContext.reduce((sum, item) => sum + item.text.length, 0);
      while (liveContext.length > 1 && liveTotal > 8000) {
        const removed = liveContext.shift();
        liveTotal -= removed?.text.length || 0;
      }
      liveContext.forEach((item, index) => { item.seq = index + 1; });
      if (!liveContext.length || liveContext.at(-1)?.speaker !== 'other' || liveTotal > 8000) return;
      const requestId = window.crypto?.randomUUID?.() || ('smart-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
      window.__dfTranslatorQueue = Array.isArray(window.__dfTranslatorQueue) ? window.__dfTranslatorQueue : [];
      window.__dfTranslatorQueue.push({
        action: 'smart-reply-request',
        requestId,
        conversationSignature: window.__dfConversationSignature || '',
        text: JSON.stringify({ latestMessageKey: latest.key, messages: liveContext }),
        at: Date.now()
      });
      button.disabled = true;
      button.textContent = '生成中…';
      button.style.opacity = '.58';
      latest.bubble.querySelector('.df-smart-reply-panel')?.remove();
    };
    if (platform === 'telegram') button.addEventListener('pointerdown', trigger, true);
    button.addEventListener('click', trigger, true);
  }
  return true;
})()
`;
}

export function buildSmartReplyUiStateScript(payload: SmartReplyUiStatePayload) {
  const serialized = JSON.stringify(payload);
  return `
(() => {
  const payload = ${serialized};
  const hosts = Array.from(document.querySelectorAll('.df-smart-reply-host'));
  const host = hosts.find((item) => item.dataset.dfSmartReplyKey === payload.latestMessageKey);
  if (!host) return false;
  const normalizeConversationSignature = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 360);
  if (normalizeConversationSignature(window.__dfConversationSignature) !== normalizeConversationSignature(payload.conversationSignature)) return false;
  const bubble = host.closest('[data-df-smart-reply-key], [data-id], [data-mid], [data-testid="msg-container"], [data-pre-plain-text], .bubble, .Message, .message-in, .message-out') || host.parentElement;
  if (!bubble) return false;
  const button = host.querySelector('.df-smart-reply-button');
  if (!button) return false;
  const removePanel = () => bubble.querySelector('.df-smart-reply-panel')?.remove();
  if (payload.state === 'clear') {
    removePanel();
    host.remove();
    return true;
  }
  if (payload.state === 'loading') {
    removePanel();
    button.disabled = true;
    button.textContent = '生成中…';
    button.style.opacity = '.58';
    return true;
  }
  button.disabled = false;
  button.textContent = '智能回复';
  button.style.opacity = '.82';
  removePanel();
  if (payload.state === 'error') {
    button.textContent = '重新生成';
    button.title = payload.message || '智能回复暂时不可用';
    return true;
  }
  const replies = Array.isArray(payload.replies) ? payload.replies : [];
  if (payload.state !== 'success' || replies.length !== 3) return false;
  const panel = document.createElement('div');
  panel.className = 'df-smart-reply-panel';
  panel.style.cssText = [
    'display:flex', 'flex-direction:column', 'gap:6px', 'margin-top:7px', 'padding:7px',
    'border:1px solid color-mix(in srgb, currentColor 24%, transparent)', 'border-radius:12px',
    'background:color-mix(in srgb, currentColor 7%, transparent)', 'color:inherit',
    'font-family:inherit', 'max-width:min(440px, calc(100vw - 80px))', 'box-sizing:border-box',
    'white-space:normal', 'clear:both'
  ].join(';');
  for (const reply of replies) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'df-smart-reply-choice';
    choice.style.cssText = [
      'appearance:none', 'border:1px solid color-mix(in srgb, currentColor 18%, transparent)',
      'border-radius:9px', 'background:color-mix(in srgb, currentColor 6%, transparent)', 'color:inherit',
      'cursor:pointer', 'display:block', 'padding:8px 10px', 'text-align:left', 'width:100%',
      'font-family:inherit', 'box-sizing:border-box'
    ].join(';');
    const english = document.createElement('div');
    english.className = 'df-smart-reply-english';
    english.textContent = String(reply.english || '');
    english.style.cssText = 'font-size:14px;font-weight:600;line-height:1.4;white-space:pre-wrap;word-break:break-word';
    const chinese = document.createElement('div');
    chinese.className = 'df-smart-reply-chinese';
    chinese.textContent = String(reply.chinese || '');
    chinese.style.cssText = 'font-size:13px;line-height:1.4;margin-top:3px;opacity:.76;white-space:pre-wrap;word-break:break-word';
    choice.append(english, chinese);
    const select = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (choice.dataset.dfSmartReplySelected === '1') return;
      choice.dataset.dfSmartReplySelected = '1';
      window.__dfTranslatorQueue = Array.isArray(window.__dfTranslatorQueue) ? window.__dfTranslatorQueue : [];
      window.__dfTranslatorQueue.push({
        action: 'smart-reply-select',
        conversationSignature: window.__dfConversationSignature || '',
        text: JSON.stringify({
          latestMessageKey: payload.latestMessageKey,
          id: reply.id,
          english: reply.english
        }),
        at: Date.now()
      });
    };
    choice.addEventListener('pointerdown', select, true);
    choice.addEventListener('click', select, true);
    panel.appendChild(choice);
  }
  const anchor = bubble.querySelector('.time, .time-inner, [data-testid="msg-meta"]');
  if (anchor?.parentElement === bubble) bubble.insertBefore(panel, anchor);
  else bubble.appendChild(panel);
  return true;
})()
`;
}
