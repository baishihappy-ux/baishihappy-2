import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProtectedSmartReplyTranscript,
  parseSmartReplyResponse,
  validateSmartReplyRequest
} from '../dist-electron/smart-reply-core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainSource = fs.readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'electron', 'preload.ts'), 'utf8');
const smartReplyMainSource = mainSource.slice(
  mainSource.indexOf('async function generateSmartRepliesWithDeepSeek'),
  mainSource.indexOf('function toggleMainWindowSize')
);
assert.match(mainSource, /trustedHandle\('smart-reply:generate', true,/);
assert.match(preloadSource, /generateSmartReplies:[\s\S]{0,160}smart-reply:generate/);
assert.match(smartReplyMainSource, /response_format:\s*\{\s*type:\s*'json_object'\s*\}/);
assert.match(smartReplyMainSource, /smartReplyRequestTimeoutMs/);
assert.doesNotMatch(smartReplyMainSource, /appendTranslateRequestLog|appendFile|console\./);
assert.match(mainSource, /pendingSmartReplyPromptPath\(\)[\s\S]{0,1200}commitReplacement/);
assert.match(mainSource, /rollbackReplacement\(snapshot\)[\s\S]{0,800}previousSmartActiveRaw/);
assert.match(mainSource, /function validateSignalSmartReplyRequest\(/);
assert.match(mainSource, /message\.type === 'smartReply\.request'/);
assert.match(mainSource, /activeConversation\.conversationId === request\.conversationId/);
assert.match(mainSource, /Date\.now\(\) - pending\.acceptedAt <= signalSmartReplyRequestTtlMs/);
assert.match(mainSource, /type: 'smartReply\.result'[\s\S]{0,240}trigger: pending\.trigger[\s\S]{0,120}replies: result\.replies/);
assert.match(mainSource, /type: 'smartReply\.error'[\s\S]{0,240}code: signalSmartReplyErrorCode\(error\)/);
assert.match(mainSource, /pendingSignalSmartReplyRequests\.delete\(appId\)/);
const signalSmartReplyResponder = mainSource.slice(
  mainSource.indexOf('async function respondToSignalSmartReplyRequest'),
  mainSource.indexOf('async function respondToSignalVisibleMessageBatch')
);
assert.doesNotMatch(signalSmartReplyResponder, /appendTranslateRequestLog|appendFile|console\.|message:\s*error/);

const validRequest = {
  requestId: 'smart-reply-test',
  profileId: 'profile-test',
  platform: 'whatsapp',
  messages: [
    { speaker: 'self', text: 'I saw https://first.example/path and it made me curious' },
    { speaker: 'other', text: 'Take a look at https://second.example/path when you have time' }
  ],
  latestSpeaker: 'other',
  replyCount: 3,
  outputLanguage: 'en-US',
  allowSensitiveEcho: false
};

assert.deepEqual(validateSmartReplyRequest(validRequest), validRequest);
const protectedTranscript = buildProtectedSmartReplyTranscript(validRequest);
assert.equal(protectedTranscript.protectedValueCount, 2);
assert.doesNotMatch(JSON.stringify(protectedTranscript.payload), /first\.example|second\.example/);
const placeholders = protectedTranscript.payload.messages.map((message) =>
  message.text.match(/__DF_LOCKED_[0-9a-f]+_0__/)?.[0]
);
assert.ok(placeholders.every(Boolean));
assert.notEqual(placeholders[0], placeholders[1], 'each bubble must have an independent placeholder namespace');

assert.throws(
  () => validateSmartReplyRequest({ ...validRequest, messages: [...validRequest.messages, { speaker: 'self', text: 'wrong newest side' }] }),
  /newest message/
);
assert.throws(() => validateSmartReplyRequest({ ...validRequest, replyCount: 2 }), /policy/);
assert.throws(() => validateSmartReplyRequest({ ...validRequest, unexpected: true }), /unknown fields/);
assert.throws(
  () => validateSmartReplyRequest({ ...validRequest, messages: [{ speaker: 'other', text: '这不是英文气泡' }] }),
  /English source text/
);

const validResponse = {
  schema_version: 'df.smart_reply.output.v1',
  replies: [
    {
      id: 'reply_1',
      english: 'That sounds genuinely fun. What part excites you most?',
      chinese: '这听起来确实很有趣。最让你兴奋的是哪一部分？'
    },
    {
      id: 'reply_2',
      english: 'I can see why that caught your attention. Where would you start?',
      chinese: '我能理解为什么这会吸引你的注意。你会从哪里开始？'
    },
    {
      id: 'reply_3',
      english: 'Now you have me curious too. What made it stand out to you?',
      chinese: '现在你也勾起我的好奇心了。是什么让它对你如此特别？'
    }
  ]
};
assert.deepEqual(parseSmartReplyResponse(JSON.stringify(validResponse)), validResponse);
assert.throws(
  () => parseSmartReplyResponse(JSON.stringify({ ...validResponse, extra: true })),
  /schema/
);
assert.throws(
  () => parseSmartReplyResponse(JSON.stringify({
    ...validResponse,
    replies: validResponse.replies.map((reply, index) => index === 0
      ? { ...reply, english: 'That sounds fun. See https://evil.example now?' }
      : reply)
  })),
  /sensitive information/
);
const normalizedPunctuation = parseSmartReplyResponse(JSON.stringify({
  ...validResponse,
  replies: validResponse.replies.map((reply, index) => index === 0
    ? { ...reply, english: 'That sounds really fun; I get your point - tell me more.' }
    : reply)
}));
assert.equal(normalizedPunctuation.replies[0].english, 'That sounds really fun, I get your point tell me more');
assert.doesNotMatch(normalizedPunctuation.replies[0].english, /[;；\-\u2010-\u2015]|\.$/u);

console.log('smart-reply: request bounds, placeholder isolation, strict JSON, style, and sensitive-output rejection passed');
