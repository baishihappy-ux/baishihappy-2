import { randomBytes } from 'node:crypto';
import type {
  SmartReplyMessage,
  SmartReplyRequest,
  SmartReplyResult,
  SmartReplySuggestion
} from './shared.js';
import { protectTranslationSensitiveTokens } from './translation-sensitive-tokens.js';

export const smartReplyInputSchemaVersion = 'df.smart_reply.input.v1' as const;
export const smartReplyOutputSchemaVersion = 'df.smart_reply.output.v1' as const;
export const smartReplyMaxMessages = 8;
export const smartReplyMaxTextBytes = 8_000;

const exactInputKeys = new Set([
  'requestId',
  'userId',
  'profileId',
  'platform',
  'messages',
  'latestSpeaker',
  'replyCount',
  'outputLanguage',
  'allowSensitiveEcho'
]);
const exactMessageKeys = new Set(['speaker', 'text']);
const exactResponseKeys = new Set(['schema_version', 'replies']);
const exactReplyKeys = new Set(['id', 'english', 'chinese']);
const allowedPlatforms = new Set(['whatsapp', 'telegram-a', 'telegram-k', 'signal']);

function hasExactKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function assertBoundedOptionalText(value: unknown, label: string, maximum: number) {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

export function validateSmartReplyRequest(value: unknown): SmartReplyRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Smart reply request is invalid.');
  }
  const request = value as Record<string, unknown>;
  if (!hasExactKeys(request, exactInputKeys)) throw new Error('Smart reply request contains unknown fields.');
  assertBoundedOptionalText(request.requestId, 'Smart reply request ID', 256);
  assertBoundedOptionalText(request.userId, 'Smart reply user ID', 256);
  assertBoundedOptionalText(request.profileId, 'Smart reply profile ID', 128);
  if (request.platform !== undefined && !allowedPlatforms.has(String(request.platform))) {
    throw new Error('Smart reply platform is invalid.');
  }
  if (!Array.isArray(request.messages) || request.messages.length < 1 || request.messages.length > smartReplyMaxMessages) {
    throw new Error('Smart reply messages must contain 1 to 8 items.');
  }
  let textBytes = 0;
  for (const item of request.messages) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !hasExactKeys(item as Record<string, unknown>, exactMessageKeys)) {
      throw new Error('Smart reply message is invalid.');
    }
    const message = item as Record<string, unknown>;
    if (message.speaker !== 'self' && message.speaker !== 'other') {
      throw new Error('Smart reply speaker is invalid.');
    }
    if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4_000) {
      throw new Error('Smart reply message text is invalid.');
    }
    if (!/[A-Za-z]{2,}/.test(message.text) || /[\u4e00-\u9fff]/.test(message.text)) {
      throw new Error('Smart reply messages must contain English source text only.');
    }
    textBytes += Buffer.byteLength(message.text, 'utf8');
  }
  if (textBytes > smartReplyMaxTextBytes) throw new Error('Smart reply transcript is too large.');
  if (request.messages.at(-1)?.speaker !== 'other' || request.latestSpeaker !== 'other') {
    throw new Error('Smart reply newest message must be from the other person.');
  }
  if (request.replyCount !== 3 || request.outputLanguage !== 'en-US' || request.allowSensitiveEcho !== false) {
    throw new Error('Smart reply request policy is invalid.');
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 16 * 1024) {
    throw new Error('Smart reply request is too large.');
  }
  return request as unknown as SmartReplyRequest;
}

export function buildProtectedSmartReplyTranscript(request: SmartReplyRequest) {
  const validated = validateSmartReplyRequest(request);
  let protectedValueCount = 0;
  const messages: SmartReplyMessage[] = validated.messages.map((message) => {
    // Each bubble receives a separate placeholder namespace. Otherwise the
    // first sensitive value in two different bubbles would both become index 0
    // under the same nonce and the model could no longer distinguish them.
    const protection = protectTranslationSensitiveTokens(message.text, randomBytes(12).toString('hex'));
    protectedValueCount += protection.tokens.length;
    return { speaker: message.speaker, text: protection.text };
  });
  return {
    protectedValueCount,
    payload: {
      schema_version: smartReplyInputSchemaVersion,
      messages,
      latest_speaker: 'other' as const,
      reply_count: 3 as const,
      output_language: 'en-US' as const,
      allow_sensitive_echo: false as const
    }
  };
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeSmartReplyEnglishPunctuation(value: string) {
  return value
    .trim()
    .replace(/[;；]+/gu, ',')
    .replace(/[\-\u2010-\u2015]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*$/u, '')
    .trim();
}

function validateSuggestion(value: unknown, expectedId: SmartReplySuggestion['id']): SmartReplySuggestion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Smart reply item is invalid.');
  const item = value as Record<string, unknown>;
  if (!hasExactKeys(item, exactReplyKeys) || item.id !== expectedId) throw new Error('Smart reply item schema is invalid.');
  if (typeof item.english !== 'string' || typeof item.chinese !== 'string') throw new Error('Smart reply text is invalid.');
  const rawEnglish = item.english.trim();
  const chinese = item.chinese.trim();
  if (!rawEnglish || rawEnglish.length > 500) {
    throw new Error('Smart reply English length is invalid.');
  }
  if (!chinese || chinese.length > 1_000 || !/[\u4e00-\u9fff]/.test(chinese)) {
    throw new Error('Smart reply Chinese preview is invalid.');
  }
  const rawCombined = `${rawEnglish}\n${chinese}`;
  if (/__DF_LOCKED_/i.test(rawCombined)) throw new Error('Smart reply contains a protected placeholder.');
  const rawOutputProtection = protectTranslationSensitiveTokens(rawCombined, randomBytes(12).toString('hex'));
  if (rawOutputProtection.tokens.length) throw new Error('Smart reply contains sensitive information.');

  const english = normalizeSmartReplyEnglishPunctuation(rawEnglish);
  if (!english || wordCount(english) < 4 || wordCount(english) > 45) {
    throw new Error('Smart reply English length is invalid.');
  }
  if (/[\u4e00-\u9fff]/.test(english)) throw new Error('Smart reply English contains Chinese text.');
  if (/[;；\-\u2010-\u2015]/u.test(english) || /\.\s*$/.test(english)) {
    throw new Error('Smart reply English punctuation is invalid.');
  }
  const combined = `${english}\n${chinese}`;
  if (/__DF_LOCKED_/i.test(combined)) throw new Error('Smart reply contains a protected placeholder.');
  const outputProtection = protectTranslationSensitiveTokens(combined, randomBytes(12).toString('hex'));
  if (outputProtection.tokens.length) throw new Error('Smart reply contains sensitive information.');
  return { id: expectedId, english, chinese };
}

export function parseSmartReplyResponse(raw: string): SmartReplyResult {
  if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw, 'utf8') > 32 * 1024) {
    throw new Error('Smart reply response is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Smart reply response is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Smart reply response is invalid.');
  const response = parsed as Record<string, unknown>;
  if (!hasExactKeys(response, exactResponseKeys) || response.schema_version !== smartReplyOutputSchemaVersion) {
    throw new Error('Smart reply response schema is invalid.');
  }
  if (!Array.isArray(response.replies) || response.replies.length !== 3) {
    throw new Error('Smart reply response must contain exactly three replies.');
  }
  const replies = response.replies.map((item, index) =>
    validateSuggestion(item, `reply_${index + 1}` as SmartReplySuggestion['id'])
  );
  const uniqueEnglish = new Set(replies.map((item) => item.english.toLocaleLowerCase('en-US').replace(/\s+/g, ' ')));
  if (uniqueEnglish.size !== 3) throw new Error('Smart replies must be distinct.');
  return { schema_version: smartReplyOutputSchemaVersion, replies };
}
