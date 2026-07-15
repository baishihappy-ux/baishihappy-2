# Signal Source-Level Integration Design

## Document Status

- Date: 2026-07-13 (America/Los_Angeles)
- Status: design frozen. Both `v8.17.0` and `v8.18.0` have completed phase one. The first two v8.18.0 phase-two slices are also complete: a fourth source patch adds visible-message events, encrypted-cache hit restoration, and a React translation slot; a fifth source patch adds an official single-new-message event and bounded live translation on cache misses. The five-patch series passed an independent clean replay, a full Windows build, 39/39 targeted Maoyi tests (including 21/21 for the new chain), the complete security regression, artifact/compatibility checks, and 14/14 real-window control assertions. Source-level composer guarding, visible-history cache-miss backfill, exact unread/notification events, and the real-account full capability matrix remain incomplete.
- Phase-one rollback baseline: Signal Desktop `v8.17.0`
- Current forward-port target: Signal Desktop `v8.18.0`
- This document and `SIGNAL_SOURCE_INTEGRATION_PLAN.md` must remain semantically synchronized.

## 1. Background and Goals

The current product bundles Signal Desktop and uses `df-bootstrap.cjs`, runtime ASAR patches, and a local control channel for the startup guard, multi-profile operation, window placement, translation probes, and notification bridging. This implementation runs, but it relies on string patches against built and minified output, making upgrades, diagnosis, and regression work expensive.

The next phase moves these integrations to controlled source boundaries. Its goals are:

1. Preserve Signal's official account database, end-to-end encryption, network protocol, and message-send implementation.
2. Move window control, message events, translation rendering, composer guarding, and notification events into stable source boundaries.
3. Remove the broad `script.execute` capability and replace it with fixed, validated, auditable typed commands and events.
4. Reduce full-DOM polling, duplicate cache lookups, duplicate DeepSeek requests, switching flicker, and CPU spikes.
5. Keep the currently accepted runtime immediately recoverable. Source experiments must not overwrite customer runtime files or login data.

### 1.1 Suite `003` Capability-Compatibility Contract

- Suite `003` has been retired from upgrade delivery by user decision, but its reasonable implemented Signal behavior remains the mandatory compatibility baseline for the `006` source integration. The source work upgrades performance and security; it does not remove features and rebuild a reduced product.
- The modified bundled Signal can be launched legally only by the maoyi launcher. Direct execution is blocked, and fallback or bypass to an official Signal installation remains forbidden.
- On the original machine, a missing valid launch credential only blocks and exits; it must not delete the original login state or data.
- If the complete Signal runtime folder and its data are copied to a foreign machine and launched directly, the guard must detect the foreign copy before the Signal account database or chat window loads, run the established full application-data-root initialization, and exit. A failed initialization remains blocked and retries on the next launch.
- Preserve existing profile isolation, launch credentials, authenticated control channel, show/hide/bounds/shutdown/heartbeat behavior, English-bubble Chinese translation, Chinese composer translation, encrypted-cache restoration, A/B/A cache restoration, unread/notification bridge, and current workspace behavior. Capabilities that still require manual acceptance must also be preserved and cannot be removed merely because acceptance is pending.
- The typed bridge, window controller, Windows owner-window relationship, and main-process lock visibility gate may only strengthen existing behavior. They must not weaken the startup guard, foreign-clone initialization, translation, cache, profile, or window-control behavior.
- Every source patch batch must first pass the machine-readable `signal-source/compatibility/v8.17.0.json` contract and the existing Signal security/function regressions. Any compatibility conflict stops the batch; customer profiles and the current `.runtime/signal-desktop` must never be used for risky validation.

## 2. Explicit Non-Goals

- Do not rewrite the Signal protocol, Signal cryptography, the Signal SQL database, or the official message-send path.
- Do not write translations into Signal's official message database.
- Do not read or export Signal private keys, session keys, attachment keys, or account authentication material.
- Do not change the WhatsApp or Telegram translation runtimes in this phase.
- Do not generate an installer, consume a suite ID, or push GitHub unless the user explicitly requests it.
- Do not commit the official source archives under `reference-sources/` to the business Git repository.

## 3. Source Baselines and Local Archives

Isolated local archives:

```text
D:\DF fanyiqi\reference-sources\Signal-Desktop-v8.17.0\Signal-Desktop-8.17.0
D:\DF fanyiqi\reference-sources\Signal-Desktop-v8.18.0\Signal-Desktop-8.18.0
```

Archive verification:

| Version | package version | Electron | ZIP SHA-256 |
| --- | --- | --- | --- |
| v8.17.0 | 8.17.0 | 42.3.0 | `8AC74903BE12CB6F4806CD3B218B1422CC9317560EA9E355DCB3EFAAF1CC9D96` |
| v8.18.0 | 8.18.0 | 42.3.0 | `A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66` |

Rules:

- The root `.gitignore` excludes `/reference-sources/`.
- Git stores only integration patches, build scripts, design documents, and the version/checksum information required to reacquire the same source.
- The forward-port gate is a clean `v8.17.0` build plus first real window-control acceptance; that gate passed on 2026-07-13. The full `v8.17.0` capability matrix remains mandatory before delivery, but no longer blocks forward-porting the same narrow patch set to `v8.18.0`.
- The clean Windows baseline build follows Signal's official unsigned-CI convention: temporarily remove the official certificate subject and fingerprint from `package.json` during the build, restore the original file byte-for-byte afterward, and generate only the `--win dir` unpacked directory rather than an NSIS installer.
- Before external delivery, separately review Signal Desktop's AGPL-3.0 obligations and the scope of corresponding source that must be offered.

## 4. Affected Modules

Existing business-project boundaries:

- `electron/main.ts`: Signal profile lifecycle, window placement, cache IPC, and the trusted control channel.
- `src/App.vue`: multi-profile workspace, cache warmup, real-time translation queue, and the current injected translation runtime.
- `signal-guard/df-bootstrap.cjs`: earliest startup guard, machine binding, and one-time launch credential.
- `tools/patch-signal-control-channel.cjs`: current built-output control-channel patch, to be retired after source integration stabilizes.
- `electron/translation-cache-crypto.ts`: machine-bound encrypted translation cache.

Initial Signal `v8.17.0` source boundaries:

- `ts/windows/main/preload.preload.ts` and related main-window preload modules: expose a minimal typed bridge.
- Signal main-process window creation and lifecycle modules: register a window controller and emit native window-state events.
- `ts/state/smart/Timeline.preload.tsx`, `TimelineItem.preload.tsx`, and message-text components: expose stable message IDs and a translation render slot.
- `ts/components/CompositionInput.dom.tsx`, `CompositionTextArea.dom.tsx`, and their smart components: enforce the pre-send Chinese guard.
- `ts/services/notifications.preload.ts` and message-notification data modules: emit exact profile, conversation, and message identifiers.

The compiler dependency graph determines the final changed-file list. Implementation must not modify the entire Signal data layer merely for convenience.

## 5. Typed Communication Model

The wire envelope currently implemented by the `v8.18.0` phase-one and phase-two slices is:

```text
version
sequence
payload.appId
payload.at
payload.type
payload.<fixed fields for that type>
mac
```

`appId` comes from the authenticated launch session and maps back to the active Signal profile; `mac` provides envelope integrity. `requestId` exists only on request-correlated types rather than being fabricated for every event. The phase-two business types added and implemented in this slice are:

```text
main client -> Signal
message.snapshot.request
translation.cacheResultBatch

Signal -> main client
conversation.changed
message.visibleBatch
translation.cacheResultApplied
```

For final delivery, the following logical context must be carried directly or bound unambiguously by the authenticated session. This is the final target contract, not a claim that today's wire envelope already uses this exact field shape:

```text
protocolVersion
suiteId
profileId
requestId (request-correlated types only)
type
payload
timestamp
```

Final-target allowlisted business commands from the main client to Signal:

```text
window.show
window.hide
window.focus
window.setBounds
window.shutdown
theme.apply
message.snapshot.request
translation.cacheResultBatch
translation.composerResult
```

Final-target allowlisted business events from Signal to the main client:

```text
runtime.ready
runtime.heartbeat
window.stateChanged
conversation.changed
message.visibleBatch
translation.cacheResultApplied
message.added
composer.changed
composer.translateRequested
composer.sent
notification.changed
runtime.error
```

Message and cache identity precedence:

1. `profileId + conversationId + messageId`
2. `profileId + conversationId + sourceHash`
3. Use `profileId + sourceHash` only as a fallback when Signal cannot provide a stable contact identifier.

Custom profile names are not part of a cache key, so renaming a profile must not invalidate or cross-wire cache records. The current envelope validates `version`, monotonic `sequence`, HMAC, authenticated `appId`, type, field lengths, and request freshness; the final logical context also validates suite and profile binding. Unknown commands are rejected. Remove the transitional `script.execute` command after the source bridge is stable.

## 6. State Flows

### 6.1 Authorized Startup

1. The main client validates `license.dat`, machine code, and suite binding.
2. It generates a 256-bit random one-time launch credential for the selected `profileId`.
3. The credential remains valid for 10 seconds, is single-use, and binds `suiteId + profileId + Signal processId`.
4. Signal validates it over a Windows named pipe before initializing the account database or window.
5. After validation, Signal establishes the typed runtime channel and sends `runtime.ready`. Failure exits without loading account data.

### 6.2 Window Placement

1. The main client is the only authority for workspace bounds and visibility.
2. Signal's main process retains its main-window object and handles `show/hide/focus/setBounds/shutdown`.
3. On Windows, experiment with a `GWLP_HWNDPARENT` owner-window relationship so Signal follows the main client's z-order, minimize, and restore behavior. Do not use cross-process `SetParent` embedding.
4. Fall back to the current positioned independent-window model if ownership is unreliable.
5. Keep bounds debounce at `80ms` and restore/switch burst at `100ms`. Do not restore a continuous `800ms` steady-state poll.
6. During dragging, perform only throttled bounds updates and do not repeatedly show/focus/moveTop. Apply one final correction when dragging stops.

### 6.3 Rendering Cached Translations

1. On conversation changes or timeline visibility changes, Signal sends a batched `message.visibleBatch` using stable message IDs.
2. The main client checks the in-memory hot cache first, then batch-queries the machine-bound encrypted disk cache.
3. It returns hits in one `translation.cacheResultBatch`.
4. Signal React components render them in fixed in-bubble translation slots as a batch instead of inserting them one by one through full-page DOM scans.
5. Translations remain an in-memory derived view and are never written to the Signal message database. Lock, hide, disconnect, reload, or close clears the Signal renderer's derived LRU, bodies, and request correlations, but does not delete the machine-bound encrypted disk cache.

### 6.4 Cache Misses and New Messages

1. `message.added`, history that a user explicitly scrolls into on a newly linked account, and manual refresh may enter the real-time translation queue.
2. Prefetching two screens above and one screen below is only for batch cache lookup; it does not automatically consume DeepSeek tokens.
3. For new-account history, visible cache misses enter `history-backfill` and run as a collected concurrent batch to avoid line-by-line visual updates.
4. A completed translation is written to the machine-bound encrypted disk cache before the in-memory hot cache and current translation slot are updated.
5. Enterprise assets must not trigger additional translations. Manual export reads only existing source text, translations, and attachments.

### 6.5 Chinese Composer Input and Sending

1. Signal's source composer reads the active conversation and current text directly; it does not depend on a periodic DOM probe for send decisions.
2. When Enter or the send button is activated, any remaining Chinese text synchronously blocks the official send action and creates a unique `requestId`.
3. A result may be written back only when `profileId + conversationId + requestId + sourceHash` all match.
4. Repeated Enter or clicks while translating attach to the same request. They do not duplicate translation, send Chinese, or concatenate results.
5. After English is written and the active conversation is revalidated, the state becomes "English pending send". The next Enter or send-button action may invoke the official send path.
6. If the user switches contacts, the old request may finish and be cached but must not write into the new contact's composer.
7. The source event `composer.sent` confirms a successful send, and the "Sent" status remains visible for 2 seconds.

### 6.6 Notifications and Unread State

1. New-message events include `profileId + conversationId + messageId`. Unread state is never inferred from history scrolling or translation rendering.
2. Top profile-tab unread counts accept only Signal's official conversation-state increments and decrements.
3. History scrolling, cached-translation restoration, manual refresh, and unread preview must not increase unread counts.
4. Notification clicks remain disabled until exact instance-token and message-ID binding is complete and passes a real notification acceptance test.

## 7. Fixed Parameters

| Item | Parameter |
| --- | --- |
| Bounds synchronization debounce | `80ms` |
| Restore/switch burst | `100ms` |
| Continuous steady-state window polling | Disabled; no `800ms` loop |
| Initial cache preload | Most recent `1000` entries |
| Conversation-history cache page | `1000` entries per page |
| Historical translation render batch | `100` bubbles per batch |
| Browser/Signal render hot cache | `1500` entries or `15MB`, whichever comes first |
| Global in-memory hot cache | `120000` entries or `320MB`, whichever comes first |
| Global real-time translation concurrency | `24` |
| Normal per-profile concurrency | `1` |
| Interactive per-profile concurrency | `2` |
| Initial history backfill per-profile concurrency | Up to `18` |
| Translation retry | `5s` and `30s`, at most two automatic retries |
| One-time launch credential | `256 bit`, `10s`, single-use |

These parameters are the baseline for the first source-integrated version. Change them only after real CPU, memory, and visual acceptance provides evidence. A refactor must not silently restore `220ms` or continuous polling.

## 8. Isolation, Compatibility, and Rollback

- Source experiments use an isolated Git branch and isolated test-output directory.
- Use only blank/test Signal profiles; never read or copy customer profiles.
- Keep the current `.runtime/signal-desktop` unchanged until the source experiment passes.
- Phase one integrates only the startup guard, typed bridge, and window control. Translation slots, composer guard, and notifications are separate later commits.
- Every phase has an independently revertible commit. Continue using the current controlled runtime if the source build fails.
- Forward-port to `v8.18.0` only after the clean `v8.17.0` build and first real window-control acceptance; that phase-one gate has passed. Keep separate manifests, patch sets, experiment directories, and artifact evidence for both versions, and never overwrite `v8.17.0`.

## 9. Security Boundaries

- Preserve and reuse the current foreign-clone protection, DPAPI device binding, suite binding, and one-time credential.
- Launch credentials must not appear in command lines, ordinary logs, localStorage, or the Signal database.
- The typed bridge rejects arbitrary JavaScript, arbitrary file paths, shell commands, and unknown message types.
- Translation cache remains per-record `AES-256-GCM`; its key is protected by Windows DPAPI and bound to `suiteId + dataRootId`.
- Production packages retain no diagnostic logs. Development/GitHub environments may retain structured diagnostics that exclude message bodies, secrets, and account material.
- Signal's official updater remains disabled. A version upgrade requires source-diff review, build validation, and real acceptance.

## 10. Implementation Order

1. `[complete]` Create this design record and the Git recovery point.
2. `[complete]` Create an isolated `v8.17.0` source experiment branch and reproducible build script.
3. `[phase one complete]` Connect the early startup guard to the source build entry while preserving the security semantics of `df-bootstrap.cjs`.
4. `[phase one complete]` Add the authenticated control bridge, main-window controller, Windows owner window, and main-process lock visibility gate, then complete the first real window acceptance.
5. `[first two phase-two slices complete]` Added current-conversation visible-message batches, encrypted-cache hit responses, a React translation slot, and bounded cache-miss live translation for a newly received single message in the current conversation. Visible-history backfill, manual refresh, and the real-account full matrix remain incomplete.
6. `[not complete]` Add the source-level composer guard and the two-Enter/button-send state machine.
7. `[not complete]` Add exact unread and notification events.
8. `[not complete]` Remove replaced minified-bundle string patches and the transitional `script.execute` command, completing the final typed allowlist.
9. `[phase one complete]` Preserve the `v8.17.0` rollback evidence and forward-port the same phase-one patch set to `v8.18.0`; both versions' full capability matrices remain mandatory before delivery.

## 11. Acceptance Criteria

### 11.1 Phase-One Forward-Port and Landing Gate (Both Versions Passed)

- `v8.17.0` completed serial replay of all three patches and an unsigned Windows directory build from isolated source. The official `package.json` was restored byte-for-byte after the build.
- The 2026-07-13 real-window report passed 14/14 assertions covering an accepted launch credential, authenticated control channel, owner relationship for the Signal main window, visibility, hide on translator minimize, show on restore, hide under the main-process lock gate, and target Signal child exit when the translator exited.
- The same three patches were serially replayed on an independent `v8.18.0` baseline, followed by an unsigned build, artifact inspection, six startup-guard/control-protocol unit tests, and a second 14/14 real-window run. The v8.17 source, artifacts, and rollback manifests were not overwritten.
- The report covers one isolated test profile and the main-process visibility gate only. It does not test the sidebar Lock button, 6+2 password, offline setup/reset, unlock, a real 15-minute wait, complete multi-profile operation, translation, composer, cache, unread, notification, dragging, theme, or CPU/memory matrices.
- Full Signal source type checking for both versions still has one official-baseline dependency error: `attachments.preload.ts` cannot resolve `fs-xattr`. The accurate conclusion is therefore “clean build and first window control passed,” not “full type checking or full capability acceptance passed.”

### 11.2 v8.18.0 Phase-Two First Slice (Current Scope Accepted)

- Added `0004-maoyi-source-translation-cache-bridge.patch`, SHA-256 `E1A261466D7D9F6C38896C7236C9E27067871320123F0BE86EE00A09ADF8F7A8`. The aggregate four-patch SHA-256 is `384B2C5DBA7AD39154E19618C36B5D9AE1ACD53279719F8BE561D49288B0605D`.
- Signal emits bodies eligible for back-translation from the current conversation only through the authenticated, unlocked, genuinely visible main window. The current projection is a deterministic “contains at least one Latin letter and no CJK character” filter, not an English-language detector. Batches are capped at 100 items or 768 KiB. Lock, hide, disconnect, reload, and close clear body correlations. Request ledgers are bounded, expiring, and one-use; message bodies are not logged or written to the Signal database.
- A result must exactly match profile, conversation, message UUID, normalized source, and compatible hash before entering the 1,500-entry/15-MiB in-memory LRU and rendering as a React text node. The translator returns encrypted-cache hits only in this slice and does not call DeepSeek.
- The main client treats empty translations, prompt leakage, source-equal text, and other historical translations unsuitable for back-translation as cache misses. An invalid or protocol-oversized legacy entry drops only that entry without exposing its body or breaking the whole batch.
- Each authenticated `appId` permits at most eight genuinely unfinished asynchronous cache lookups. Conversation changes, hide, or lock clear request and body correlations, but a lookup continues to occupy its concurrency count until its Promise actually settles, so cross-conversation clearing cannot bypass the limit. The 128-entry replay ledger for each `appId` evicts completed work first and then not-yet-responding pending work, but never evicts a responding entry; if all 128 entries are responding, the new ledger entry is rejected.
- On lookup failure or saturation, the main client sends a valid empty `translation.cacheResultBatch` for the same request in the legal main-client-to-Signal direction. It no longer sends `type:error`, which is valid only as a Signal-to-main-client event. This preserves cache-miss semantics and prevents batch flooding from provoking protocol rejection and a disconnect denial of service; the `test:signal-cache-response` automated contract covers and passes these root-process boundaries.
- The fixed Chinese-to-English contract is `你确定吗？` to `Are you sure?`: the question mark may not be lost, is normalized to exactly one ASCII `?`, and must not remain full-width or become `??`. This contract currently lives in the main translator's composer path in `electron/shared.ts` and `electron/main.ts`, with an automated check in `tools/test-composer-question-mark.mjs`; it does not mean that the Signal source-level composer guard is complete.
- A second independent replay from the official ZIP proved that all 24 patched files are byte-identical and retain LF. The replay tool now explicitly disables Windows global `core.autocrlf=true`, which had converted patched files to CRLF.
- The full build, 34 targeted Maoyi Signal tests, 380 static rules over 23 source files, Prettier, Stylelint, artifact inspection, compatibility contracts, and the complete root security regression passed. Full-source type checking still reports only the existing missing `fs-xattr` baseline error and is not recorded as passing.
- After the final LF source replay, build, and artifact inspection, the three output identities remain unchanged: `Signal.exe` is 227,025,408 bytes with SHA-256 `01136BB24024D0D1E5BA0B20357D94F0DB73F3E3A1D3461260462F74400D7C80`; `app.asar` is 31,490,598 bytes with 1,115 entries and SHA-256 `9C6579AC615F10067382DF86DD6D1558FCE2E9B9FBD2C211F1BFE4065D57AF86`; `windows-ucv.node` has SHA-256 `A4E10BF7A7524416950423AE40075DC2BC469DC3BF0D5CBCB6E873F27F8E21DA`.
- The latest real-window report, `.tmp/signal-source-ui/2026-07-13T19-13-57-209Z-55d629ad/artifacts/report.json`, passed 14/14 assertions in 33.042 seconds. The visible capture SHA-256 is `525F0B77875E9E4B0EADC39969E51EF1942555F4C768C9C834D6BF3183EC8D18`; the lock-gate capture SHA-256 is `531491CED27FA6B8C064C8ECE7037114FAE2C6BED582E71C9F0EBB85338C7100`. The `test:signal-transitional-status` automated contract passes, and manual inspection of the latest lock-gate capture further confirms no stale “message scan failed” banner, Signal window, QR code, or chat content—only normal Signal-started and input-listener-installed status. This report validates the invoked lock gate and stale-status fix, not an unimplemented automatic remote-control mask.
- The acceptance harness previously checked only the target element and ignored hidden ancestors, so it misclassified an invisible application center as entered. It now checks the full ancestor chain plus actual layout visibility, permits only one bounded entry click, and records staged diagnostics containing no account data, message bodies, secrets, or credentials on failure.
- This slice has not yet accepted cached translation bubbles in a real linked account, real SG01/SG02 and contact A/B/A switching, source-level Chinese composer sending, unread/notifications, the complete theme/drag/CPU/memory matrix, or removal of transitional `script.execute`. The phase-one gaps for restart lock gating, Signal-window activity resetting idle time, heartbeat acknowledgement timeout, per-secondary-window ownership, explicit owner/transport health state, native-dialog coverage, and remote-capture protection all remain incomplete.

### 11.3 v8.18.0 Phase-Two Second Slice (Current Scope Passed)

- Added `0005-maoyi-realtime-message-translation.patch`, SHA-256 `8E7DFAB5EAC76B075826BF4382BBEFFE59D370FBE48A3C2FBF45D59E4D7F9ABA`; the aggregate five-patch SHA-256 is `0E268344E842B0939D1B75E3D92BFB206C562112E2C2ED535F6670766B426417`. The patch contains only nine expected source and test files, passes `git apply --check --whitespace=error-all` on an independent replay of the first four patches, and all nine clean-replayed files match the development tree by SHA-256.
- Signal emits only from the official `MESSAGES_ADDED` path when `isNewMessage=true`, `isActive=true`, the reducer confirms that the message was actually added, and the same conversation remains selected before and after processing. History loading, background conversations, duplicates, attachments, polls, CJK-only bodies, and protocol-oversized bodies do not trigger live translation.
- The main client independently validates `message.added`: the normalized body must match the projection, contain 1–4,000 characters and at least one Latin letter, contain no CJK, and reproduce the compatibility hash. The queue is encrypted-cache-first and calls DeepSeek only on a miss, with global concurrency 24, per-profile concurrency one, a pending limit of 128, and only two retries at 5 and 30 seconds after the initial failure.
- The queue key binds profile, conversation, message UUID, compatibility hash, and SHA-256 of the normalized full body, preventing duplicate calls and 32-bit hash-collision aliasing. A useful translation must be saved successfully to the machine-bound encrypted cache before a new snapshot request is issued; empty, prompt-leaking, source-equal, or otherwise unsuitable results are neither saved nor refreshed.
- Lock, hide, conversation switch, disconnect, or client replacement clears queued, retry, and refresh work and aborts in-flight network requests with `AbortController`. Lifecycle eligibility is rechecked after every asynchronous wait and before and after cache writes; stale tasks cannot continue to the network, save, or refresh. New dynamic contracts cover cache-hit zero API, save-before-refresh, deduplication, concurrency, two retries, rejection of item 129, semantic rejection, and cancellation during cache lookup or an in-flight network request.
- The independent clean replay completed a full Windows build in 85.2 seconds with pinned Node `24.15.0` and pnpm `11.5.2`. All targeted Maoyi tests passed 39/39, including 21/21 focused new-chain tests; Oxlint reported zero errors and zero warnings, and Prettier, compatibility, artifact, and complete root security checks passed. Full source type checking still has only the existing official-baseline missing-`fs-xattr` error in `attachments.preload.ts`, so it is not recorded as passing.
- Final clean artifacts: `Signal.exe`, 227,025,408 bytes, SHA-256 `4C2CA50F29E883BA55EDFFF45E8A8CEF8E71EBC8F2E5C24E8BEAB4FBEAF01852`; `app.asar`, 31,493,657 bytes and 1,115 entries, SHA-256 `F103D60718D0D9CBA276102BB8382B08F6F391D51DF3E53BF0F6960E414F9BA7`; `windows-ucv.node`, 224,768 bytes, SHA-256 `582751A922C78A2C50234F666F06B190ABA5073BAD0A32FF6E783B0E4404DF8F`.
- The latest real-window report, `.tmp/signal-source-ui/2026-07-13T20-42-15-586Z-355a12fb/artifacts/report.json`, passed 14/14 assertions for the exact source artifact, launch credential, authenticated control channel, Windows owner relationship, minimize/restore, main-process lock visibility gate, and process-exit coupling. The visible capture SHA-256 is `B6E4E62444AB22B2EB022ACED7397A4D7F7F9C9C6A4A27C447C59A3FA2475D3F`; the lock-gate capture SHA-256 is `68F5BBDCA77CD6384A51D71102C45D72C3D74EA238C7EDFF31AD171A0F8E5D89`.
- No real linked Signal test account is available to automation, so the user-visible scenario “receive one English message and see its Chinese translation” has not received human UI acceptance. Visible-history cache-miss backfill, manual refresh, the source-level composer guard, exact unread/notification events, and retirement of the legacy message-DOM translation path also remain incomplete. The transitional `script.execute` command cannot be removed wholesale until source capability gates cover composer, message, unread, and notification behavior.
- This slice did not replace `.runtime/signal-desktop`, read a customer profile, package or install, consume `006` or any other suite ID, create a Git commit, or push GitHub.

### 11.4 Final Delivery Acceptance

Automated checks:

- Both the Signal `v8.17.0` rollback baseline and the current `v8.18.0` delivery baseline build reproducibly from clean source using their respective manifests and patch sets.
- Type checks, unit tests, protocol allowlist tests, encrypted-cache tests, and startup-guard tests pass.
- Build output contains no secrets, customer data, login state, enterprise assets, translation cache, or runtime logs.
- Static checks confirm that production paths contain no `script.execute` or arbitrary `executeJavaScript` control command.

Required real UI checks:

- The main client launches bundled Signal legally; standalone Signal is blocked; there is no fallback to official Signal.
- At least two Signal profiles can be created, linked, and closed, with no residual instance process after close.
- SG01/SG02 switching, contact A/B/A switching, main-client minimize/restore, drag, resize, theme switching, and foreground/background switching all preserve placement.
- Signal does not cover unrelated foreground applications, and it truly hides when the main client minimizes or switches to WhatsApp/Telegram.
- Previously cached bubbles render immediately after switching back. Restart batch-loads encrypted cache before considering DeepSeek work and does not waste tokens while warmup is incomplete.
- A newly linked account translates actively viewed history in batches without line-by-line visual gaps.
- Rapid Chinese paste, rapid double Enter, send-button click, and contact switching never send Chinese, concatenate translations, or write a result to the wrong contact.
- New-message unread counts match Signal's official state. History scrolling, cache restoration, and preview do not create unread counts.
- Receive and inspect one real notification under the current policy. Do not claim notification clicks work until exact token binding is complete.
- Observe idle, profile switching, minimize/restore, and history backfill in Task Manager. There must be no continuous `800ms` window sync, and the bridge must not raise steady idle CPU.

Only after automated checks pass and the real UI scenarios are manually exercised on this machine may the result be described as "verified". A successful build is not a real test.

## 12. Git and Release Rules

- This design document, its Chinese counterpart, and the root `.gitignore` form the pre-integration recovery point.
- Before committing, run `git status`, `git diff --check`, a sensitive-file scan, and ignore-rule checks.
- A local recovery point is not a GitHub push. Do not push unless the user explicitly requests it.
- Public `maoyi` pushes still require checks for debranding, secrets, customer data, login state, cache, and installers.
- The complete official Signal source is not part of this business commit. Before distributing a modified Signal build, separately satisfy license and corresponding-source obligations.
