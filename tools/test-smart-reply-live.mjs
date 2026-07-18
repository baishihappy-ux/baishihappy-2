import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildProtectedSmartReplyTranscript,
  parseSmartReplyResponse,
  validateSmartReplyRequest
} from '../dist-electron/smart-reply-core.js';
import { decryptSmartReplyPromptBundle } from '../dist-electron/smart-reply-prompt-bundle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secrets = path.join(root, '.package-secrets');
const config = JSON.parse((await fs.readFile(path.join(secrets, 'trial-config.json'), 'utf8')).replace(/^\uFEFF/, ''));
const apiKey = String(config.deepseekApiKey || '').trim();
if (!apiKey) throw new Error('DeepSeek API key is missing.');
const encryptedPrompt = await fs.readFile(path.join(secrets, 'smart-reply-prompt.dfp'), 'utf8');
const { prompt } = decryptSmartReplyPromptBundle(apiKey, encryptedPrompt);
const request = validateSmartReplyRequest({
  requestId: 'smart-reply-live-contract',
  userId: 'df-smart-reply-live-contract',
  profileId: 'smart-reply-live-contract',
  platform: 'whatsapp',
  messages: [
    { speaker: 'self', text: 'I keep saying I should cook more, but takeout keeps winning' },
    { speaker: 'other', text: 'I have been learning a few Italian dishes lately and it is actually pretty relaxing' }
  ],
  latestSpeaker: 'other',
  replyCount: 3,
  outputLanguage: 'en-US',
  allowSensitiveEcho: false
});
const input = JSON.stringify(buildProtectedSmartReplyTranscript(request).payload);
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 25_000);
try {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: config.deepseekModel || 'deepseek-v4-flash',
      user_id: request.userId,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: input }
      ],
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      temperature: 0.65,
      max_tokens: 1_000,
      stream: false
    })
  });
  if (!response.ok) throw new Error(`DeepSeek live smart reply failed: ${response.status}`);
  const envelope = await response.json();
  const content = envelope?.choices?.[0]?.message?.content;
  const result = parseSmartReplyResponse(content);
  console.log(JSON.stringify(result, null, 2));
} finally {
  clearTimeout(timeout);
}
