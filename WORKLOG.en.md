# Worklog

## 2026-07-08 Archive: Translation Cache, Signal Display, Telegram Pending Fix

This archive records the current engineering state so future work can continue from it. It is not a claim that the full UI experience has passed real manual validation.

Code state:

- Signal display stability keeps the current parameters: 80 ms bounds-sync debounce and 100 ms restore/switch burst.
- Permanent 800 ms steady-state Signal sync is not a planning parameter. Signal display sync should be triggered by short bursts on window changes, platform switches, and restores.
- Translation cache is split into three layers: chunked disk cache, in-memory hot cache, and per-fingerprint-browser render cache.
- Global in-memory hot-cache cap: 120000 entries or 320 MB.
- Current conversation preload: latest 1000 entries.
- Per-fingerprint-browser render cache cap: 1500 entries or 15 MB.
- History scroll pre-rendering uses batches. Each batch loads at most 100 bubble translations and commits cache hits to the page in one display batch, avoiding visibly broken item-by-item rendering.
- Enterprise chat assets use the separate `EnterpriseChatAssets` path and are not mixed into the `TranslationCache` path.
- Enterprise chat asset archiving remains silent in the frontend, with no settings, buttons, or visible copy.

Still pending:

- Telegram translation mounting is still unresolved: translated text can be placed incorrectly inside the bubble, and the refresh button can become unresponsive.
- Competitor local package inspection found that its core runtime likely loads remote code through a `scriptUrl`. The local package alone does not confirm the exact Telegram mounting algorithm.
- Next step: stop deobfuscating the competitor package. When the user provides a local Telegram HTML file, fix our own Telegram selectors, mount node, width locking, and refresh-button behavior from the real DOM.

Hard verification rule:

- `npm.cmd run build` proves only project build checks.
- For window behavior and WhatsApp/Telegram/Signal translation behavior, the result can be called verified only after the main app is opened and the real UI path is manually tested.

## Current Goal

Recreate and evolve the external reference-style chat translation workspace inside `<project-root>`.

## Current Truth

The UI has gone through multiple phases:

- Initial external reference-inspired layout reconstruction.
- Multi-profile WhatsApp and Telegram webview support.
- Signal Desktop multi-instance research and runtime patching.
- Signal overlay display stabilization.
- Theme switching and brand asset work.

Do not claim UI completion unless the actual app has been visually checked against the required reference state.

## Hard Constraints

- Do not touch authorization or license logic.
- Treat `<external-reference-root>` as read-only reference material.
- Do not bypass, integrate with, or simulate authorization checks.
- Do not push temporary screenshots, login state, runtime cache, customer data, enterprise configuration, or API keys to GitHub.

## Completed Highlights

- Added competitor runtime research:
  - WhatsApp and Telegram are hosted inside the competitor Electron app.
  - Signal is a separate embedded Signal Desktop runtime.
- Implemented WhatsApp / Telegram multi-profile containers:
  - Profiles are stored as `ChatProfile` records.
  - Each profile uses one persistent Electron partition.
  - Each workspace tab loads the official platform URL inside a webview.
- Added platform catalog IPC and per-profile session setup.
- Removed manual fingerprint controls from the UI.
- Implemented automatic per-profile isolation values.
- Rebuilt the frontend from earlier corrupted Chinese UI text.
- Added multiple visual themes and theme switching.
- Added Signal research and runtime control:
  - embedded Signal runtime
  - per-instance `--user-data-dir`
  - `--appId`
  - `--wsPort`
  - `--windowMode=embed`
  - WebSocket control channel
- Stabilized Signal display behavior using a top-level frameless overlay model.
- Added enterprise chat asset archive design.
- Added GitHub general-release rules for the `maoyi` white-label version.

## Verification Wording Rule

- `npm.cmd run build` proves build/type/bundle checks only.
- It does not prove actual UI behavior.
- For window behavior, only say actual behavior was verified after the app is restarted and the UI path is manually tested.

## Known Deferred Items

- WhatsApp has at least one deferred leak-translation case where a visible English bubble can appear without Chinese translation and without a per-bubble refresh button.
- Telegram bubble translation was the cleaner baseline during the last related investigation.
- Signal notification click routing is intentionally deferred until display behavior remains stable.
- Full Signal chat history extraction is not assumed; runtime-visible messages and translation events are the realistic first capture target.

## Suggested Next Steps

- Keep Signal display behavior stable before adding new Signal notification routing.
- Add the unified chat archive schema and local SQLite storage before building AI advice features.
- Build AI advice on top of structured archived data, manual labels, and RAG before considering model fine-tuning.
- For GitHub pushes, use the isolated `maoyi` general-release directory and run the bilingual GitHub checklist first.

## 2026-07-10 Checkpoint

Implemented in source:

- First-launch data-location selection with automatic `maoyi Data` folder creation.
- Local enterprise archive library and per-contact HTML timelines.
- Persistent exclusion of contacts whose incoming first-history or latest message is Chinese; excluded contacts reject cache/archive writes and existing scoped data is removed.
- The operator's Chinese composer input is excluded from translation disk cache and enterprise assets.
- Development runs only the project-controlled Signal runtime; packaged clients only accept bundled Signal. Official Signal fallback is forbidden.
- Packaged-client runtime logging is disabled in source, with startup and normal-exit cleanup. Development logging remains enabled.
- Offline licensing and send-integrity requirements are archived in synchronized Chinese and English documents.

Verified scope:

- Build and type checks passed after the current source changes.
- Isolated runtime tests confirmed English archive writes, Chinese-source rejection, persistent contact exclusion, scoped data removal, archive library generation, and custom data-root writes.
- Real WhatsApp, Telegram, and Signal UI validation of boundary-message contact classification remains incomplete.
- The packaged no-log policy and bundled-only Signal rule have not been retested in a newly generated installer.

Hard rules:

- Do not build a new installer unless the user explicitly requests packaging.
- A build check is not an actual UI verification.
- Production packages retain business data but do not retain runtime diagnostic logs.
- Git and GitHub must never include service secrets, login state, customer data, enterprise archives, translation cache, runtime Signal data, screenshots, or generated installers.

Deferred implementation:

- Numeric payment account and USDT wallet send-integrity transactions.
- IPC sender validation, fixed command allowlists, WebView origin/navigation restrictions, ASAR integrity, and Electron Fuses.
- Offline `license.dat` protocol, client verification/login, and the standalone black-gold license issuer.
- Complete archive barrier, attachment capture, and safe profile-data deletion after durable archive completion.

Future-version planning:

- English voice-message translation to Chinese is recorded as a future-version feature. It is not included in the current customer acceptance build.
- Target experience: an English voice message is transcribed to English text first, then translated to Chinese, with the Chinese translation displayed under the matching voice bubble.
- Implementation order: Telegram first, then WhatsApp, then Signal.
- Cache principle: transcripts and translations must be written to translation cache. Restart, profile switching, and history scrolling must use cache first to avoid repeated API calls.
- Enterprise-asset principle: future archive records may include the voice attachment index, English transcript, and Chinese translation. Audio binaries must not be embedded directly into message text records.

Latest offline-licensing rules:

- On first launch, the license issuer requires creating the issuer password and warns that it must be remembered.
- The issuer does not generate the customer's login password. The customer username and 6-character letter-and-digit login password are managed locally by the main client.
- The issuer outputs both `license.dat` and a license code. The license code is the text form of the `license.dat` content and can be copied from the issuer UI.
- After the client receives the license code, it automatically writes `license.dat` under the current application data directory.
- Every delivered suite has its own `suiteId` and signing key. A license generated by suite A's issuer cannot be used by suite B's client.
- The developer environment keeps 10,000 unique 9-digit suite IDs. Every full-suite packaging attempt consumes one ID at the beginning, and the ID is never recycled whether packaging succeeds or fails.
- The independent key must be generated using the consumed unique suite ID and permanently bound to `suiteId`, `keyId`, public-key fingerprint, encrypted-private-key fingerprint, and output directory.

Codex collaboration skill:

- A personal skill named `design-before-implementation` has been created to require explicit design, parameters, logic, and acceptance criteria before critical implementation work.
- The personal skill lives at `<CODEX_HOME>\skills\design-before-implementation`.
- The project-tracked copy lives at `chat-translator/codex-skills/design-before-implementation` so it can be uploaded with GitHub later.
- Future edits to the personal skill must also update the project-tracked copy.

Offline license issuer step 1 implementation:

- Added license core logic: `DFLIC1` license-code format, license-code issuing/parsing, signature verification, and suite ID/username/machine-code checks.
- Added base issuer UI: first-run issuer password setup, password login, lockout ladder, license-code generation, license-code copy, and `license.dat` save.
- Added suite ID tooling: the developer environment creates 10,000 unique 9-digit suite IDs; every suite generation consumes one ID and never recycles it; current suite key config is written under `.package-secrets`.
- This development test consumed 2 local suite IDs, both under the ignored `.package-secrets` directory.
- Build check, license-code core self-test, and suite ID registry integrity check passed.
- Not completed: main-client license-code input and `license.dat` writing, client startup verification, customer username/password rules, real issuer UI manual acceptance, and full-suite packaging.

## 2026-07-11 Bundled Signal Foreign-Clone Protection

- Added device-signed runtime binding, per-Signal-profile binding, a `256-bit` one-time credential, and a Windows named-pipe handshake.
- Replaced the Signal `app.asar` main entry with an early guard. The original main module and account database do not load before credential validation.
- Added original-machine standalone blocking, foreign-copy detection, complete data-root initialization, and retry-on-failure behavior.
- Packaging now forcibly reinjects the Signal guard and excludes both the development binding sidecar and the unguarded Signal backup archive.
- Actually verified authorized launch, original-machine standalone blocking, full deletion of a temporary foreign Signal copy, and full deletion of temporary foreign data detected by the main client.
- Real hardware mismatch on a second Windows computer and all paths in a newly generated installer remain unverified.
- See `SIGNAL_CLONE_PROTECTION.en.md` for the complete design, parameters, and validation boundary.

## Existing-Customer Upgrade Rule for 003

- An upgrade must reuse suite `183105912`'s original `suiteId + keyId + complete key pair`. Reusing only the numeric ID while generating new keys would invalidate the existing `license.dat`.
- Replace program files only, preserving the storage pointer, authorization, device identity, profiles, and WhatsApp/Telegram/Signal login state.
- On the first encrypted-cache release, delete only the old plaintext `TranslationCache` and each platform's `df.translation.renderCache.*`; do not migrate old translations. Write a one-time completion marker, then create only machine-bound encrypted caches.
- New customers still consume a new nine-digit suite ID and receive an independent key pair.

## 2026-07-12 Security Hardening and Send Integrity

- Electron, WebView, IPC, licensing, translation cache, Signal control, and package boundaries are hardened; see `SECURITY_HARDENING.en.md`.
- Two-Enter transactions now cover numeric payment accounts and TRC20/ERC20/BEP20/Solana addresses; fixed parameters and acceptance boundaries are in `SEND_INTEGRITY_DESIGN.en.md`.
- Permanent lockout, self-destruction, and uninstall after five consecutive invalid license codes remain unchanged.
- The user explicitly excluded item 10 (modified Signal Authenticode HashMismatch) and item 12 (installer/issuer code signing).
- Automated security checks, the real controlled-Signal launch test, and isolated Electron window smoke tests passed. Real payment-information sends on all three platforms still require human acceptance.
- This pass did not package, consume a suite ID, create a Git commit, or push GitHub.

## 2026-07-12 Signal Cached-Translation Switching Optimization

- This pass only optimizes cached-translation restoration during Signal contact A/B/A switching. It does not change DeepSeek real-time translation rules, cache capacity, WhatsApp, or Telegram.
- The cache-application scheduler state machine now preserves follow-up work across consecutive DOM changes.
- When Signal inserts or reuses bubble nodes, a page microtask scans only the affected subtree with a limit of 200 candidates per batch. Full-pass retries at `16/48/96/180ms` remain as fallback.
- When Signal reuses an old bubble DOM node after its translation child has disappeared, the stale hash marker is cleared and the cached translation is mounted again immediately.
- Cache limits remain 1,500 entries or 15MB. Window bounds debounce at `80ms` and restore/switch burst at `100ms` are unchanged.
- `npm.cmd run build`, `npm.cmd run test:security`, and a synthetic Signal A/B/A regression using the real Electron rendering engine passed.
- The local `profiles.json` is currently empty, so a real logged-in Signal contact A/B/A manual acceptance test is still pending. The remote 003 customer build does not contain this source change.
- This pass did not package, consume a suite ID, create a Git commit, or push GitHub.

## 2026-07-12 End-to-End Translation Cache Encryption Completed

- The authoritative disk cache remains `TranslationCache/v3`: every record uses independent `AES-256-GCM`, with a 32-byte key protected by Windows DPAPI and bound to `suiteId + dataRootId`.
- Plaintext reads and writes for the main-renderer `df.translationCache.v1` key and fingerprint-browser `df.translation.renderCache.v1.*` keys are removed.
- Fingerprint-browser pages now keep only an in-process translation hot cache capped at 1,500 entries or 15 MB. Restart restoration is batched from encrypted disk cache.
- The main-renderer legacy key is removed at startup, WhatsApp/Telegram keys are removed at WebView readiness, and each Signal key is removed on its next authorized launch. Migration does not mass-launch Signal or damage login state.
- The security gate prevents reintroducing renderer `localStorage.setItem` plaintext persistence.
- Build, the security suite, the real-Electron DOM cache regression, and isolated client/issuer window smoke tests passed. Both smoke screenshots were visually inspected and rendered correctly.
- No installer was built, no suite ID was consumed, and nothing was pushed to GitHub. Source is included in the local pre-refactor Git recovery point; the WhatsApp/Telegram refactor has not started.
