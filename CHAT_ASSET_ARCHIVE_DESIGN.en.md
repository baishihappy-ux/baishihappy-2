# Enterprise Chat Asset Archive Design

## Positioning

Chat records are not temporary cache. They are enterprise assets.

The translator should archive private one-on-one conversations from Signal, WhatsApp, and Telegram, together with translation results, successful sales patterns, failed cases, and typical error samples.

As more client users generate conversations, this archive becomes enterprise soft power. New employees can use AI suggestions to understand customer intent faster, reuse effective wording, avoid common mistakes, and improve deal conversion.

## Core Principles

1. Closing a multi-instance profile does not delete archived assets.
   - Closing releases runtime resources.
   - Already captured chat assets remain stored.

2. Still-open profiles must keep receiving notifications.
   - Auto-closing Signal profiles to save resources breaks real-time notification receiving.
   - Resource optimization must not break the business rule: if it is open, it is online and receives notifications.

3. No group-chat model.
   - Current business scope is one-on-one private chats only.
   - Do not keep group name, group member, or group-thread fields.

4. Raw chat data and AI training data must be layered.
   - Raw records support audit, search, and review.
   - AI usage requires cleaning, desensitization, labeling, and structure.

## Runtime And Session Lifecycle

Signal is an independent desktop client instance:

- Each Signal profile uses an independent `signalDataDir`.
- Closing a Signal profile must stop the corresponding `Signal.exe` processes by matching that directory.
- Signal profiles that remain open must keep running to receive notifications.

WhatsApp and Telegram are web sessions:

- Closing a profile should destroy the corresponding `webview` or session host.
- Closed profiles should not keep background WebSockets, timers, translation tasks, or invisible page resources alive.
- Releasing runtime resources is separate from preserving archived chat assets.

## Unified Data Model

Use this chain:

```text
enterprise -> operator -> platform profile -> private contact -> message
```

### Private Contact

- `contact_id`: internal contact ID.
- `enterprise_id`: enterprise ID.
- `operator_id`: operator ID.
- `platform`: Signal, WhatsApp, or Telegram.
- `profile_id`: multi-instance profile ID.
- `profile_name`: profile name such as SG01, WS01, TG01.
- `external_id`: platform identifier such as phone number, username, or Signal identifier.
- `phone_number`: phone number, nullable.
- `username`: username, nullable.
- `display_name`: platform display name.
- `remark_name`: contact remark name.
- `avatar_asset_id`: avatar asset ID, nullable.
- `last_message_at`: latest conversation time.
- `created_at`: first archive time.
- `updated_at`: last update time.

### Message

- `message_id`: internal message ID.
- `platform_message_id`: platform message ID, nullable.
- `enterprise_id`: enterprise ID.
- `operator_id`: operator ID.
- `profile_id`: multi-instance profile ID.
- `contact_id`: private contact ID.
- `direction`: `inbound` for customer messages, `outbound` for operator messages.
- `message_type`: `text`, `image`, `video`, `file`, or `voice`.
- `source_text`: original text.
- `translated_text`: translated text.
- `source_language`: source language.
- `target_language`: target language.
- `sent_at`: platform send time.
- `received_at`: client receive time.
- `archived_at`: archive time.
- `quoted_message_id`: quoted message ID, nullable.
- `send_status`: sent, failed, or unknown.
- `is_deleted`: whether the message was deleted or recalled.
- `raw_payload_ref`: raw capture fragment reference for debugging.

### Asset

Images, videos, files, and voice messages should not be embedded directly in the message table.

- `asset_id`: asset ID.
- `message_id`: related message ID.
- `asset_type`: image, video, file, voice, or thumbnail.
- `storage_path`: local or server object storage path.
- `sha256`: file hash for deduplication and tamper detection.
- `mime_type`: media type.
- `file_name`: file name.
- `file_size`: file size.
- `duration_ms`: audio/video duration, nullable.
- `width`, `height`: image/video dimensions, nullable.
- `ocr_text`: OCR text for images, nullable.
- `created_at`: archive time.

### AI Label

- `label_id`: label ID.
- `message_id` or `conversation_id`: related message or conversation.
- `label_type`: success case, failure case, typical mistake, excellent reply, sensitive risk, customer refusal, deal signal.
- `label_source`: human label, rule label, or AI pre-label.
- `confidence`: confidence.
- `note`: human note.
- `created_by`: label creator.
- `created_at`: label time.

## Storage Format

Local client:

- Use `SQLite` for structured chat events.
- Store attachments as files. Store only path, hash, type, and related message ID in the database.
- Write locally first to avoid data loss during network outages.

Enterprise server:

- Use `PostgreSQL` for contacts, messages, labels, and sync state.
- Use object storage for images, videos, files, and voice assets.
- Queue client sync while offline and upload after reconnect.

AI export:

- Use `JSONL` for training and evaluation records.
- Use `CSV` for operations and management review.
- Desensitize phone numbers, names, emails, addresses, order numbers, and payment information before AI use.

## Capture Strategy

WhatsApp / Telegram:

- Use page injection to capture visible messages, new messages, send events, contact information, and translation results.
- Deduplicate records so page redraws do not duplicate messages.

Signal:

- Capture visible runtime messages, notification events, send events, and translation events through the independent Signal runtime.
- Do not assume complete historical message extraction is available.
- Full history capture requires separate Signal-specific research.

Translator itself:

- Archive every translation request and result.
- Link original text, translated text, language, model, operator, profile, and contact.

## AI Usage Roadmap

Phase 1: unified archive.

- Save chat records, translation results, assets, and contacts.
- Ensure records are searchable, traceable, and syncable.

Phase 2: review and labeling.

- Managers label conversations as success cases, failure cases, typical errors, and excellent replies.
- Label quality determines AI advice quality.

Phase 3: AI suggestions.

- Retrieve similar historical cases based on the current conversation context.
- Prefer `RAG` first: retrieve similar cases and then generate advice.
- Evaluate model fine-tuning only after the data is clean and labels are stable.

Phase 4: new employee support.

- When a new employee opens a customer conversation, the system suggests similar successful cases, common mistakes, and reply drafts.
- Employees review and edit suggestions before sending.
- Management keeps improving the archive with excellent replies and error samples.

## Implementation Order

1. Define the local SQLite schema.
2. Capture visible WhatsApp / Telegram messages.
3. Archive translator-owned translation requests and results.
4. Capture Signal runtime messages and events.
5. Archive and deduplicate attachments.
6. Add enterprise server sync.
7. Add management search, review, and labeling.
8. Add AI suggestions and new-employee assisted replies.

## Contact Archive and Exclusion Rules (2026-07-10)

- The operator's Chinese composer input is not an enterprise chat asset and is not written to translation cache or enterprise archives.
- If the contact's first historical message or latest message is Chinese, persistently mark that contact as excluded from caching and archiving.
- Classification only uses incoming message bodies. Outgoing messages and quoted Chinese text do not trigger exclusion.
- After exclusion, remove that contact's existing translation cache and chat archive and reject future writes.
- The archive library entry point is `EnterpriseChatAssets/index.html`, searchable by contact, platform, or profile.
- Each contact has an independent `index.html` timeline showing date, direction, English source, Chinese translation, and timestamp.
