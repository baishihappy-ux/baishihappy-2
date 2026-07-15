import { inspectSensitiveSendText, type SensitiveSendKind } from './payment-address.js';

export type ProtectedTranslationToken = {
  placeholder: string;
  value: string;
  kind: SensitiveSendKind | 'url' | 'literal';
};

export type ProtectedTranslationInput = {
  text: string;
  tokens: ProtectedTranslationToken[];
  nonce: string;
};

type SensitiveRange = {
  start: number;
  end: number;
  value: string;
  kind: SensitiveSendKind | 'url' | 'literal';
};

const candidatePatterns = [
  /(?<![0-9A-Za-z])0x[0-9a-fA-F]{40}(?![0-9A-Za-z])/g,
  /(?<![0-9A-Za-z])T[1-9A-HJ-NP-Za-km-z]{33}(?![0-9A-Za-z])/g,
  /(?<![0-9A-Za-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![0-9A-Za-z])/g,
  /(?<!\d)(?:\d[ ]*){6,34}(?!\d)/g
];

const immutableLiteralPatterns: Array<{ pattern: RegExp; kind: 'url' | 'literal' }> = [
  { pattern: /https?:\/\/[^\s<>"'，。！？；：]+/gi, kind: 'url' },
  { pattern: /\b(?:www\.)[^\s<>"'，。！？；：]+/gi, kind: 'url' },
  { pattern: /(?<![\w-])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?![\w-])/g, kind: 'literal' }
];

function collectSensitiveRanges(text: string) {
  const candidates: SensitiveRange[] = [];
  for (const { pattern, kind } of immutableLiteralPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || !match[0]) continue;
      candidates.push({ start: match.index, end: match.index + match[0].length, value: match[0], kind });
    }
  }
  for (const pattern of candidatePatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const leadingSpaces = match[0].length - match[0].trimStart().length;
      const value = match[0].trim();
      const inspection = inspectSensitiveSendText(value);
      if (!inspection.valid || !inspection.kind) continue;
      const start = match.index + leadingSpaces;
      candidates.push({ start, end: start + value.length, value, kind: inspection.kind });
    }
  }

  candidates.sort((left, right) => left.start - right.start || right.end - right.start - (left.end - left.start));
  const accepted: SensitiveRange[] = [];
  for (const candidate of candidates) {
    if (accepted.some(range => candidate.start < range.end && candidate.end > range.start)) continue;
    accepted.push(candidate);
  }
  return accepted.sort((left, right) => left.start - right.start);
}

export function protectTranslationSensitiveTokens(text: string, nonce: string): ProtectedTranslationInput {
  if (!/^[0-9a-f]{16,64}$/i.test(nonce)) throw new Error('Translation token nonce is invalid.');
  const ranges = collectSensitiveRanges(text);
  const tokens: ProtectedTranslationToken[] = [];
  let cursor = 0;
  let protectedText = '';
  for (const range of ranges) {
    const placeholder = `__DF_LOCKED_${nonce}_${tokens.length}__`;
    protectedText += text.slice(cursor, range.start) + placeholder;
    tokens.push({ placeholder, value: range.value, kind: range.kind });
    cursor = range.end;
  }
  protectedText += text.slice(cursor);
  return { text: protectedText, tokens, nonce };
}

export function restoreTranslationSensitiveTokens(
  translatedText: string,
  protection: ProtectedTranslationInput
) {
  let restored = translatedText;
  for (const token of protection.tokens) {
    const occurrences = restored.split(token.placeholder).length - 1;
    if (occurrences !== 1) {
      return { ok: false as const, reason: '敏感信息占位符丢失、重复或已被修改' };
    }
    restored = restored.replace(token.placeholder, token.value);
  }
  if (restored.includes(`__DF_LOCKED_${protection.nonce}_`)) {
    return { ok: false as const, reason: '敏感信息占位符未完全恢复' };
  }
  return { ok: true as const, text: restored };
}
