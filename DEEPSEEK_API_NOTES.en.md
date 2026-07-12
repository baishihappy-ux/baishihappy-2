# DeepSeek API Integration Notes

Record date: 2026-07-06

Official documentation: https://api-docs.deepseek.com/

## Conclusions

- The API uses an OpenAI-compatible format.
- Base URL: `https://api.deepseek.com`
- Chat Completions endpoint: `POST /chat/completions`
- Full URL: `https://api.deepseek.com/chat/completions`
- Authentication: HTTP header `Authorization: Bearer <API Key>`
- Request format: JSON.
- Response format: JSON. The translated content is read from `choices[0].message.content`.

## Current Model Choice

Current default model:

```text
deepseek-v4-flash
```

Reasons:

- Fast and economical enough for default chat translation.
- Better fit for low-latency translation than a heavier reasoning flow.
- Chat translation does not need visible reasoning output.

Legacy model names recorded in earlier notes:

- `deepseek-chat`
- `deepseek-reasoner`

## Translation Request Standard

Default chat translation disables thinking:

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    {
      "role": "user",
      "content": "Translate the following chat message to English..."
    }
  ],
  "thinking": {
    "type": "disabled"
  },
  "temperature": 0.2
}
```

Prompt requirements:

- Return only the translated message.
- Keep emoji unchanged.
- Keep URLs, phone numbers, product names, and line breaks unchanged.
- Do not add extra quotes, prefixes, suffixes, explanations, or comments.

## Current Main Process Function

- Function: `translateWithDeepSeek`.
- Location: `electron/main.ts`.
- Default model: `deepseek-v4-flash`.
- Response extraction: `choices?.[0]?.message?.content?.trim()`.

## API Key Storage Rule

- Never commit API keys to Git.
- During development, the key is stored only in local `config.json`.
- Field name: `deepseekApiKey`.
- The GitHub general release must not include real keys, tokens, cookies, account data, or local login state.

## Future Platform Integration

WhatsApp / Telegram:

- Inject scripts into Electron `webview`.
- Translate Chinese drafts to the target language before sending.
- Translate incoming English bubbles into Chinese.
- Keep platform-specific DOM handling separate.

Signal:

- Do not treat Signal as a normal web app.
- Use the embedded Signal Desktop runtime.
- Each Signal profile uses an isolated `SignalInstances/Signal-<id>` data directory.
- Chat translation requires the Signal child process control channel, such as WebSocket or IPC.
