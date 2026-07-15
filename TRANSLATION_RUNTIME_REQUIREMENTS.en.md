# Translation Runtime Requirements Archive

This file archives the current requirements for the translation runtime, cache display, live backfill translation, unread indicators, notifications, lightweight runtime behavior, and real UI testing.

These items are implementation constraints, not a claim that every feature is already complete. Future changes must consider user experience, CPU usage, memory usage, and multi-profile stability together.

## 1. Bubble Detection

Detect chat bubbles by DOM location, not by filtering English words.

Non-Chinese content inside confirmed chat bubbles enters the cache-first translation system.

## 2. Instant Cache Display

On app restart, profile switching, conversation switching, and history scrolling, cached translations must be loaded in batches and injected in batches.

The target experience is close to the competitor: scrolling back several screens should still display translations immediately.

A cache hit must not call the translation API.

## 3. Live Backfill Translation Queue

Only content missing from cache enters the live translation queue.

The queue must support priority, deduplication, concurrency limits, and retry handling, so multiple profiles cannot trigger large bursts of requests or CPU load.

## 4. Outgoing English Bubble Back-Translation

Outgoing English bubbles sent by our user must still call the English-to-Chinese translation API.

They must not reuse the original Chinese draft directly.

Purpose: show the user how the actual English expression back-translates into Chinese, helping future Chinese input better match natural English expression.

## 5. Chinese Enter-To-English Composer Flow

When the user types Chinese and presses Enter, the app first translates Chinese to English and writes English into the native composer.

The next Enter sends the English message.

Signal, WhatsApp, and Telegram should provide the same user experience as much as possible.

## 6. Refresh Button Semantics

The refresh button must bypass cache, force a new translation API call, and replace the old translated node.

The refresh path must not be blocked by an existing translation node and must not keep showing old English-to-English bad output.

## 7. Bad Cache Cleanup

English-to-English bad translations and invalid translations must not be displayed and must not continue to be written into cache.

Existing bad cache records on disk should be cleaned in the background without blocking foreground user actions.

## 8. Conversation Identity

Cache must be isolated by profile account and conversation target.

Contact title, phone number, remark, and platform-side conversation identity should be as stable as possible to avoid cache leakage between customers.

## 9. Batched History Scroll Strategy

When the user scrolls history, the app first checks cache in batches and injects cached translations into the page.

Historical bubbles missing from cache then enter a low-priority background backfill queue. The user should not wait for one-by-one translation.

## 10. Unified Three-Platform Experience

WhatsApp, Telegram, and Signal must share the same core experience:

- instant cache display
- live backfill translation
- Chinese Enter-to-English composer flow
- outgoing English bubble back-translation
- forced refresh retranslation
- unread indicators

## 11. Unread Indicators

Unread indicators must use WhatsApp, Telegram, and Signal native unread/read state as the source of truth.

The app only mirrors and displays platform state; it must not guess unread counts by itself.

Left-side platform logos: if any profile under a platform has unread messages, that platform logo flashes.

Top multi-profile tabs: each profile card shows a red badge with white unread count at the upper-left corner, without conflicting with close or rename controls.

## 12. Notification Reliability

Opened profiles should keep receiving notifications as much as possible.

Notification clicks must not cause side effects such as opening a new Signal instance.

Unread indicators must not depend on system notification clicks; they depend on native platform unread/read state synchronization.

## 13. Lightweight Runtime Behavior

The app must minimize CPU and memory usage.

Requirements:

- The active profile has higher priority.
- Background profiles are checked at lower frequency.
- Do not scan all historical DOM.
- Do not keep every cache record resident in memory.
- Persist the full cache on disk; keep only the current conversation, recent conversations, and necessary indexes in memory.
- Historical backfill, bad cache cleanup, and enterprise asset writes run as background idle batch jobs.
- UI flashing uses CSS animation, not high-frequency JavaScript timers.

## 14. Enterprise Chat Assets

Enterprise assets must be archived silently in the background: chat target, direction, time, source text, translated text, quotes, media indexes, and related metadata.

The frontend must not expose enterprise chat asset settings, buttons, or visible copy.

## 15. No Residual Processes After Closing Profiles

After closing Signal, WhatsApp, or Telegram profiles, related runtime resources must not remain running.

Closing runtime resources must not delete chat records, translation cache, or enterprise assets.

## 16. Signal Display Stability

After minimize/restore, profile switching, or platform switching, Signal must stay attached to the main workspace.

It must not flicker, disappear, or spike CPU during restore or switching.

## 17. Real UI Testing

Build checks cannot replace real behavior verification.

The following paths must be manually tested in the real UI:

- restart the main app
- switch profiles
- switch conversations
- scroll up through history
- send new Chinese input
- receive a reply
- click refresh
- unread count increase/decrease
- left logo flashing
- top profile-tab unread badge
- close a profile with no residual process
- Signal restore and switching stability

Only after the real UI path is manually tested may the corresponding experience be described as verified.

## Concrete Implementation Parameters

The following values are the initial defaults for implementation. If real UI testing shows lag, missed translations, or false positives, tune these values with evidence. Do not replace bounded work with unlimited scanning or unlimited API requests.

### 1. Bubble Detection

Requirement: translate non-Chinese content inside chat bubbles only, without filtering by English words.

Implementation:

- Implement one `messageAdapter` per platform.
- The adapter emits confirmed bubble candidates only; it must not emit chat lists, top bars, composers, menus, or contact cards.
- Candidate fields: `profileId`, `platform`, `contactId`, `contactTitle`, `messageKey`, `sourceHash`, `sourceText`, `direction`, `messagePart`, `timestamp`, `mountSelectorHint`.

Parameters:

- Minimum text length: 2 characters.
- Maximum text length: 4000 characters.
- Scan range: current viewport plus 2 screens above and 1 screen below for prefetch.
- Do not filter bubble text by words such as `voice`, `message`, `online`, or `search`.

Acceptance:

- Short messages such as `No voice. So sad`, `Nothing just a voice message`, and `Happy Ending` must not be filtered out.
- Composer placeholders and chat lists must not be translated as bubbles.

### 2. Instant Cache Display

Requirement: after restart, profile switching, conversation switching, or history scrolling, cached translations appear in batches first.

Implementation:

- Persist full cache on disk.
- Keep only hot cache in memory: current conversation, recent conversations, and required indexes.
- Page injection checks cache first. A cache hit renders immediately and does not enter the live translation queue.
- Disk cache must be chunked by `platform/profileId/contactKey/chunk`. Profiles must not read and write one shared giant cache file.
- Each conversation must persist manual browsing progress. If the user scrolls back through history, the cache progress is saved to that point.
- Translation hot cache is only for instant display and duplicate-translation avoidance. Enterprise asset archiving must use the separate `EnterpriseChatAssets` path and must not be mixed into `TranslationCache`.

Parameters:

- Current conversation preload: latest 1000 cached entries.
- Recent conversation retention: keep indexes for all recent conversations; hot data enters memory by recency.
- Recent conversation hot-load size: latest 1000 cached entries per conversation.
- Global hot-cache cap: 120000 translated entries or 320 MB, whichever comes first.
- Disk chunk size: about 1000 records or 1-2 MB per chunk, whichever comes first.
- Do not treat 320 MB as one cache file size; 320 MB is only the global in-memory hot-cache cap.
- Per-profile browser render hot cache: max 1,500 entries or 15 MB, whichever comes first. It lives only in the active fingerprint-browser process memory and serves fast re-rendering after conversation switching. Translation plaintext must never be written to `localStorage` or other page-persistent storage.
- Browser render cache is not authoritative; `TranslationCache` remains the source of truth.
- Cache injection batch size: max 200 candidate nodes.
- Per trigger processing cap: 800 candidate nodes.
- Near-viewport range: 2 screens above and 1 screen below. This range is only for cached rendering, not live translation API scanning.
- `MutationObserver` scheduling: next animation frame; overlapping runs are merged into one pending pass.
- Scroll throttle: 180 ms.

Acceptance:

- Cached translations on the current screen appear immediately after profile switching.
- When scrolling back several screens, cached translations appear in batches, not one by one through API calls.

### 3. Live Backfill Translation Queue

Requirement: only cache misses call the translation API.

Implementation:

- Build a shared `translationQueue`.
- All platforms use global concurrency limits.
- The same `profileId + sourceHash` can have only one active translation task.

Parameters:

- Global translation concurrency: 2.
- Per-profile concurrency: 1.
- Active viewport cache-miss tasks: max 8 per cycle.
- Historical background backfill: max 3 per idle batch.
- Retry count: max 2.
- Retry delay: 5 seconds, then 30 seconds.
- Same-source dedupe window: 10 minutes.

Priority:

1. Manual refresh.
2. Chinese Enter-to-English composer translation.
3. Outgoing English bubble back-translation.
4. Incoming new reply English-to-Chinese translation.
5. First-use historical backfill.

Acceptance:

- CPU must not stay saturated when multiple profiles receive messages.
- Manual refresh must not wait behind a large historical backfill queue.

### 4. Outgoing English Bubble Back-Translation

Requirement: outgoing English bubbles from our user must call English-to-Chinese translation.

Implementation:

- When a `direction = outgoing` English bubble is detected, it still enters the cache-first path.
- If cache misses, call English-to-Chinese translation.
- Do not reuse the user's original Chinese draft as that bubble's Chinese translation.

Parameters:

- Newly sent outgoing bubbles have higher priority than historical backfill.
- An outgoing bubble detected within 10 seconds after sending is marked as newly sent and prioritized.

Acceptance:

- After sending English, the bubble shows the back-translated Chinese result, not the original Chinese draft.

### 5. Chinese Enter-To-English Composer Flow

Requirement: Chinese Enter translates Chinese to English first; the next Enter sends the English message.

Implementation:

- Chinese detection runs only when the composer has focus.
- After translation, replace the native composer content with English.
- The second Enter is passed through to the platform's native send behavior.

Parameters:

- Chinese pretranslation debounce: 300 ms.
- Signal composer detection runs only when Signal is focused or the active Signal profile is selected.
- Signal input polling: 360 ms when active; no composer polling while inactive.
- Translation timeout status: 15 seconds.

Acceptance:

- Signal, WhatsApp, and Telegram support Chinese Enter-to-English.
- Enter must not be blocked when there is no Chinese text.

### 6. Refresh Button Semantics

Requirement: refresh forces retranslation and replaces the old translation.

Implementation:

- Refresh bypasses cache.
- On success, remove old `.df-chat-translation` nodes and insert the new translation.
- After quality checks pass, overwrite the cache with the new result.

Parameters:

- Manual refresh has highest priority.
- Process at most 3 manual refresh candidates per cycle to avoid excessive work for quote + body combinations.
- Refresh button visual feedback lasts 1600 ms.

Acceptance:

- Clicking refresh on an English-to-English bad result must not keep showing the old result.

### 7. Bad Cache Cleanup

Requirement: bad cache must not display and must not keep polluting disk cache.

Implementation:

- Quality-check cached results when reading.
- Remove bad entries from memory immediately.
- Rewrite disk cache in background idle tasks.

Parameters:

- Bad cache rule: source has English and translation has no Chinese, or normalized source and translation are exactly equal ignoring case.
- Cleanup interval: 10 minutes.
- Max records per cleanup pass: 500.
- Pause cleanup while the user is scrolling, typing, or switching profiles.

Acceptance:

- Records like `Race is over` translated as `Race is over` must not keep displaying.

### 8. Conversation Identity

Requirement: cache is isolated by profile account and conversation target.

Implementation:

- Main cache key includes `platform + profileId + contactKey + sourceHash`.
- `contactKey` priority: platform conversation ID > phone number > username > title hash.
- Title is a fallback only and must not be treated as the only reliable long-term identity.

Parameters:

- Read at most 6 title candidate nodes.
- Phone extraction requires at least 7 digits.
- If `contactKey` changes, keep old cache but write new data under the new key.

Acceptance:

- The same English sentence in two customer conversations must not leak translations across customers.

### 9. Batched History Scroll Strategy

Requirement: scrolling back several screens should display cached translations quickly.

Implementation:

- Scroll triggers batch cache injection.
- History render prefetch must load translations in batches: max 100 conversation bubbles per batch. Cache hits are committed to the page in one display batch, not revealed a few items at a time.
- Historical bubbles missing cache enter the low-priority backfill queue.
- Historical backfill must not block visible new messages.
- Persist per-conversation manual browsing progress, then resume cache loading near the viewed range when the user returns to that conversation.

Parameters:

- Scroll throttle: 180 ms.
- Above-viewport prefetch: 2 screens.
- Below-viewport prefetch: 1 screen.
- History render prefetch scan range: 3 screens above and 2 screens below.
- History render prefetch batch size: max 100 bubble translations.
- Cache injection cap per scroll trigger: 800 candidate nodes.
- Historical backfill per cycle: max 3.
- Manual browsing progress fields: `oldestViewedKey`, `oldestViewedAt`, `lastViewedRange`.

Acceptance:

- Fast upward scrolling shows cached translations in batches without waiting for API calls one by one.

### 10. Unified Three-Platform Experience

Requirement: WhatsApp, Telegram, and Signal use the same translation experience.

Implementation:

- Use shared queue, cache, quality checks, and refresh semantics.
- Platform differences stay inside adapters.

Parameters:

- Every adapter emits the same candidate structure.
- Platform differences must not leak outside cache identity rules.

Acceptance:

- All three platforms support instant cache display, live backfill, Chinese composer flow, outgoing back-translation, refresh, and unread indicators.

### 11. Unread Indicators

Requirement: unread counts use native platform unread/read state as the source of truth.

Implementation:

- Implement one `unreadAdapter` per platform.
- Read platform native unread sources: title, chat-list badges, platform DOM state, or Signal standalone-window state.
- Maintain `unreadByProfileId` and `unreadByApp`.

Parameters:

- Active profile unread sync: 2 seconds.
- Background profile unread sync: 10 seconds.
- Minimized main app unread sync: 15 seconds.
- State update debounce: 300 ms.
- Top-tab badge: show 1-99, then `99+`.
- Badge style: red background, white text, upper-left corner of the profile card, no overlap with close or rename controls.
- Left-logo flash cycle: 1.2 seconds CSS animation.

Acceptance:

- If any profile under a platform has unread messages, the left platform logo flashes.
- When entering a platform, each top profile tab shows its own unread count.
- When the platform read state clears, our UI clears too.

### 12. Notification Reliability

Requirement: opened profiles should keep receiving notifications; unread indicators do not depend on system notification clicks.

Implementation:

- Do not route profile activation through system notification clicks.
- Do not use Signal notification clicks to activate instances, because that can open a new Signal instance.
- Sync unread state from native platform unread sources.

Parameters:

- Opened profiles must not be auto-closed to save resources.
- Background profiles use low-frequency checks while preserving platform notification capability.

Acceptance:

- Opened instances can receive new message indicators.
- Clicking a system notification must not create a new Signal instance.

### 13. Lightweight Runtime Behavior

Requirement: minimize CPU and memory usage without breaking experience or notifications.

Implementation:

- Active profile has higher priority; background profiles are low frequency.
- DOM scans only cover candidate ranges, not full historical DOM.
- Full cache persists on disk; only hot data stays in memory.
- Enterprise asset writes, bad-cache cleanup, and historical backfill run as background batches.

Parameters:

- Global hot-cache cap: 120000 entries or 320 MB.
- Background profile scan interval: no less than 10 seconds.
- Active profile scan interval: no less than 2 seconds, except manual refresh or input events.
- Enterprise asset flush: 15 seconds or 200 records.
- Target maximum single main-thread background task duration: under 16 ms.

Acceptance:

- Profile switching, main-window restore, and history scrolling must not keep CPU at 100%.
- Idle CPU should be close to silent.

### 14. Enterprise Chat Assets

Requirement: archive chat assets silently in the background without affecting foreground UX.

Implementation:

- After a translation cache write, enqueue enterprise asset writes asynchronously.
- Asset records include contact, direction, time, source text, translation, quote, and media indexes.
- No frontend settings, buttons, or visible copy for enterprise assets.
- Enterprise asset archiving must use the separate `EnterpriseChatAssets` path and must not be mixed with translation hot cache.
- `TranslationCache` serves foreground instant display and deduplication only; `EnterpriseChatAssets` serves enterprise asset retention, later search, review, and AI-data preparation.

Parameters:

- Batch size: max 200 records.
- Flush delay: 15 seconds.
- Current file format: `JSONL`; future migration to SQLite is allowed.

Acceptance:

- The frontend exposes no enterprise asset entry point.
- Closing a profile does not delete archived assets.

### 15. No Residual Processes After Closing Profiles

Requirement: closing a profile releases runtime resources while preserving data.

Implementation:

- For WhatsApp/Telegram, destroy the webview, timers, translation tasks, and hot cache for that profile.
- For Signal, shut down the exact Signal child process by profile ID.

Parameters:

- Check for remaining resources 2 seconds after close.
- If Signal graceful shutdown fails, force terminate after 5 seconds.
- Do not delete disk cache, chat assets, or login state unless the user explicitly requests data cleanup.

Acceptance:

- After closing a profile, Task Manager shows no corresponding residual running instance.

### 16. Signal Display Stability

Requirement: Signal switching and restore must not flicker, disappear, or spike CPU.

Implementation:

- Attach the Signal standalone window to the workspace only when the current Signal profile is active.
- Use the existing window control channel for hide/show.
- Avoid repeated show/hide/bounds operations during short switching windows.

Parameters:

- Bounds sync debounce: 80 ms, matching the current code.
- After main-window restore, attempt Signal sync at most 3 times.
- Restore/switch burst: 100 ms, matching the current code.
- Do not use 220 ms show/hide as a planning parameter.
- Do not use permanent 800 ms steady-state sync polling; use short bursts on window change, switch, or restore.

Acceptance:

- After minimizing and restoring the main app, the current Signal stays in the workspace.
- SG01/SG02 switching does not disappear, flicker, or saturate CPU.

### 17. Real UI Testing

Requirement: build success is not behavior verification.

Implementation:

- For every UI, window, notification, or translation-chain change, list the actual manual test paths.
- If the app was not manually opened and tested, report only build success and state that real UI verification was not performed.

Parameters:

- Required paths: restart, switch profiles, switch conversations, scroll history, send Chinese, receive a reply, refresh, unread counts, close profile, Signal restore.
- Test at least 1 logged-in instance per platform.
- Test at least 2 Signal profiles for switching.

Acceptance:

- Only a manually tested real UI path can be marked verified.

### 18. English Voice-Message Translation to Chinese (Future Version)

Status: future-version planning only. It is not implemented or accepted in the current version.

Requirement: when the other side sends an English voice message, translate the voice content into Chinese and show it under the matching voice bubble without changing the existing text-bubble experience.

Target experience:

- The user sees an English voice message.
- The app identifies the voice content.
- The app runs speech-to-text first, then English-to-Chinese translation.
- The Chinese translation appears under that exact voice bubble, using the same visual style as text-bubble translations.
- The result is written to translation cache. After restart, profile switching, or history scrolling, cache is used first and the app must not waste repeated API calls.
- Enterprise chat assets may later store the voice attachment index, English transcript, and Chinese translation. Audio binaries must not be embedded directly into message text records.

Suggested implementation order:

- Phase 1: Telegram. Use Telegram Web voice-message DOM first to validate bubble detection, audio extraction, transcription, translation, caching, and injection.
- Phase 2: WhatsApp. Reuse the same cache and bubble-injection strategy, then add WhatsApp voice-bubble detection and audio-resource extraction.
- Phase 3: Signal. Implement after the first two platforms are stable because Signal is a standalone controlled window and its voice resources and injection control are more complex.

Technical chain:

- Detect the voice bubble.
- Extract the audio file or audio resource.
- Run STT (speech-to-text) to obtain English text.
- Translate English to Chinese.
- Write to `TranslationCache` (translation cache path).
- Write asynchronously to `EnterpriseChatAssets` (enterprise chat asset path).
- Attach the Chinese translation under the matching voice bubble.

Principles:

- Do not include voice-message translation in the current customer acceptance build.
- Do not let the future voice feature affect text-bubble translation, unread preview, Chinese Enter-to-English translation, or Signal display stability.
- The speech-to-text provider must be evaluated separately for cost, speed, privacy, and accuracy. Local models consume hardware; cloud STT adds API cost and privacy boundaries.
- The cache key must bind platform, profile ID, conversation target, voice-message unique ID or audio-content hash to avoid repeated transcription and repeated translation.
- Until real UI manual testing is complete, mark this feature as planned only, never as supported.

### 19. WhatsApp / Telegram K Cached-Rendering Refactor (Pending)

Status: the design is confirmed, but platform behavior code has not been implemented. Signal is explicitly outside this refactor.

Boundaries:

- Extract one shared cached-rendering core and separate WhatsApp and Telegram K adapters.
- Message scanning, cached injection, live-result injection, and refresh controls must use the same adapter; duplicate mounting implementations are forbidden.
- Split conversation identity into a stable `conversationId` and display-only `conversationDisplay`. Send integrity, composer translation, contact exclusion, and caching use the same stable ID.
- Telegram A retains the legacy implementation initially. The Telegram K adapter must never run against Telegram A.
- Unread preview remains an independent read-only path and must not open conversations or mutate native unread state.
- Signal input, cache behavior, unread preview, and window control remain unchanged.

Order:

- Create a pre-refactor Git recovery point first.
- Extract the shared core and Electron DOM regression fixtures without immediately changing real platform behavior.
- Implement and manually accept Telegram K first, then WhatsApp.
- Remove legacy full-page scans and duplicate fallbacks only after both platforms pass real acceptance.
