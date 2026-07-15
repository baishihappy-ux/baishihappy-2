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

Recreate and evolve the Look World-style chat translation workspace inside `D:\DF fanyiqi\chat-translator`.

## Current Truth

The UI has gone through multiple phases:

- Initial Look World-inspired layout reconstruction.
- Multi-profile WhatsApp and Telegram webview support.
- Signal Desktop multi-instance research and runtime patching.
- Signal overlay display stabilization.
- Theme switching and brand asset work.

Do not claim UI completion unless the actual app has been visually checked against the required reference state.

## Hard Constraints

- Do not touch authorization or license logic.
- Treat `D:\DF fanyiqi\look world` as read-only reference material.
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
- The personal skill lives at `C:\Users\admin\.codex\skills\design-before-implementation`.
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

## Suite 003 Retirement and New Suite 006 Rule

- The user confirmed that suite `003` is no longer an existing-version upgrade target. Do not create a `003` upgrade package or provide in-place upgrades, license reissues, or data migration; installed users must discontinue that version.
- The next delivery suite is named `006`; this name is not a nine-digit `suiteId`.
- Deliver `006` as a completely new and isolated suite. Consume a fresh nine-digit suite ID and generate independent keys only when the user explicitly requests real packaging. Never reuse suite `003` / `183105912` `suiteId`, `keyId`, or key material.
- Do not install `006` as an overwrite upgrade on `003`. Migration is not promised for the `003` storage pointer, authorization, device identity, profiles, or WhatsApp/Telegram/Signal login state.
- This pass records the naming and delivery decision only. It does not package, consume a suite ID, or generate `006` keys.

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

## 2026-07-12 Official Signal Source Archive and Source-Integration Design

- Complete official Signal Desktop `v8.17.0` and `v8.18.0` source trees and ZIP archives are stored in an isolated root folder. Root `.gitignore` excludes `reference-sources/` from the business Git repository.
- Both `package.json` versions were verified and both use Electron `42.3.0`. ZIP SHA-256 values are recorded so the same source can be reacquired and verified after machine loss.
- Synchronized Chinese and English documents, `SIGNAL_SOURCE_INTEGRATION_PLAN.md` and `SIGNAL_SOURCE_INTEGRATION_PLAN.en.md`, now define the implementation boundary.
- The implementation baseline is locked to `v8.17.0`: startup guard, typed bridge, and window control come first, followed by separate phases for React translation slots, composer guarding, exact unread state, and notifications. Forward-port to `v8.18.0` only after real acceptance of the baseline.
- The current controlled Signal runtime and customer profiles were not changed. This pass did not build Signal, run UI acceptance, package, consume a suite ID, or push GitHub.

## 2026-07-12 Isolated Signal v8.17.0 Source Experiment Environment

- Created the isolated `experiment/signal-source-v8.17.0` branch so Signal source experiments do not happen directly on `master`.
- Added a tracked `v8.17.0` baseline manifest and patch series that lock the official ZIP SHA-256, patch-set SHA-256, Signal/Node/pnpm/Electron versions, isolated directory, disk-space gates, and official build commands. Future source changes must enter Git as verified patches.
- Added five entry points: `check`, `prepare`, `verify`, `preflight`, and `build`. `prepare` atomically extracts only the verified ZIP into `.tmp/signal-source/v8.17.0`; when the directory exists, it verifies and exits without overwriting experiment changes.
- Actually generated the isolated copy. Both the reference source and experiment copy contain `4,176` files and `91,424,412` bytes, and `chat-translator/.gitignore` excludes the experiment directory.
- Build preflight confirmed Python 3.13.13, Corepack 0.34.6, and approximately 609 GiB of free space. Current Node 24.14.1 does not match the official 24.15.0 requirement, and Visual Studio 2022 C++ Build Tools were not found, so dependency installation and the official Signal build were deliberately blocked and cannot be reported as passed.
- The current `.runtime/signal-desktop`, customer profiles, and Signal source remain unchanged. This pass did not launch Signal UI, package, consume a suite ID, or push GitHub.

## 2026-07-12 Pre-Reboot Recovery Note: Signal Dragging Stutter

Completed:

- The pre-integration design recovery point is commit `4da0e3e`; the isolated Signal source experiment recovery point is commit `052f6f9`; the current branch is `experiment/signal-source-v8.17.0`.
- Complete official Signal Desktop `v8.17.0` and `v8.18.0` source trees and ZIP archives are isolated under `reference-sources/` and ignored by Git. Both ZIP SHA-256 values are recorded in the synchronized design documents.
- The `v8.17.0` experiment workflow now supports official archive verification, a tracked patch series, atomic preparation, repeat verification, toolchain preflight, and an official build entry point.
- The isolated `v8.17.0` copy was actually generated. The reference and experiment trees both contain `4,176` files and `91,424,412` bytes.
- The main-project build and security gate pass. Signal build preflight deliberately blocks before dependency installation when the environment is incomplete.
- Task Manager dragging was compared in three states: Maoyi closed, Maoyi open without visible Signal, and Signal visible. Task Manager has the same independent minor stutter in all three states while ordinary windows drag normally, so Task Manager's behavior is not caused by Maoyi or Signal and is not evidence of system-wide dragging stutter.
- Dragging Maoyi while Signal is visible still has a more noticeable stutter. It remains a Signal window-placement issue and must not be conflated with Task Manager's own refresh behavior.

Not completed:

- The first local build of unmodified official Signal `v8.17.0` is not complete. Current Node is `24.14.1` while official source requires `24.15.0`; Visual Studio 2022 Desktop development with C++ has not been found.
- No business patch has been applied to official Signal source, and the experiment build has not replaced `.runtime/signal-desktop`.
- The Windows owner-window relationship, source-level window controller, direct `setBounds`, and suppression of `show/focus/moveTop` during dragging are not implemented.
- Real acceptance after source integration is not complete for main-window dragging, z-order, minimize/restore, SG01/SG02 switching, CPU, or memory.

Post-reboot execution order:

1. With Maoyi closed, drag an ordinary window and Task Manager. Set Task Manager's real-time update speed to Paused and drag it again to isolate its own refresh behavior.
2. Open Maoyi without visible Signal and drag the main window; then show Signal and repeat, comparing pointer response and transient CPU use.
3. If visible Signal still causes clear stutter after reboot, continue the source approach. Do not restore continuous polling or add brute-force refreshes.
4. Complete the isolated build toolchain: exact Node `24.15.0`, pnpm `11.5.2` through Corepack, and Visual Studio 2022 C++ Build Tools; retain Python 3.13.13.
5. Build completely unmodified official Signal `v8.17.0` first. Do not claim the build passes until a real clean build succeeds.
6. Apply source patches in phases: startup guard and typed bridge first, then the window controller and Windows owner-window experiment. Do not change translation, notifications, and composer behavior in the same phase.
7. Keep bounds debounce at `80ms` and restore/switch burst at `100ms`, and remove continuous `800ms` steady-state sync. Only real dragging evidence may justify changing the drag-only path to at most one update every `33ms`.
8. Evaluate replacing `.runtime/signal-desktop` only after real acceptance passes. Do not generate an installer or consume a suite ID unless the user explicitly requests packaging.

## 2026-07-12 Signal v8.17.0 Source-Upgrade Compatibility Contract

- The user reconfirmed that `003` is no longer an upgrade-delivery target, but its reasonable implemented Signal capabilities remain the mandatory behavior baseline for the `006` source integration and must not be lost during refactoring.
- The modified Signal can be launched legally only by maoyi. Original-machine direct launch only blocks and exits while preserving data; direct launch after the complete Signal runtime and data are copied to a foreign machine must run the established full data-root initialization before the account database loads.
- Existing profile isolation, startup guard, control channel, window control, translation, cache, unread/notification, and workspace behavior are all zero-regression requirements. The source upgrade exists to improve performance and security while reducing CPU, memory, and window-synchronization cost.
- Added the machine-readable `signal-source/compatibility/v8.17.0.json` contract and the `test:signal-source-compatibility` static regression, and included it in the complete security test.
- No Signal business source patch is applied yet. This pass did not replace `.runtime/signal-desktop`, read a customer profile, package, consume a `006` suite ID, or push GitHub.

## 2026-07-13 Signal v8.17.0 Phase-One Baseline Completed

This section records the actual 2026-07-13 build and window evidence. It updates, but does not erase, the historical recovery notes from 2026-07-12.

Confirmed complete:

- The official v8.17.0 ZIP SHA-256 is `8AC74903BE12CB6F4806CD3B218B1422CC9317560EA9E355DCB3EFAAF1CC9D96`. The three source-patch SHA-256 values are `DE7BAEA1511C856AA4681F9F1689701D414FC67371C716656902640685C9136A`, `E4268FA2FAE0FBAEEA6ABF463C5A91CACD0F917E43C82211DA30DF76DB83B632`, and `78CDC75C460C6CC398585FCECF51FD74556F01E32CBC37E3D4D22C337E0685CD`. The v8.17.0 patch-set SHA-256 is `6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052`.
- Serial replay of all three patches and an unsigned Windows directory build completed using pinned Node `24.15.0`, pnpm `11.5.2`, Visual Studio 2022 C++ Build Tools, and the Windows SDK. The official `package.json` was restored byte-for-byte afterward.
- `Signal.exe` is 227,025,408 bytes with SHA-256 `5D74F92F8130849582F095C8A29E3DAB28CCFBF305BD85ACA82617F87B47E8A9` and Authenticode status `NotSigned`; this is an isolated development artifact, not an installer. `app.asar` is 31,466,370 bytes with 1,114 entries and SHA-256 `A412604288AFE55380589B12860726C6BAFC646DA972A7FE9F353500ACA683E0`. `windows-ucv.node` is 224,768 bytes with SHA-256 `00F1AD57295675ADC97103DF30C33E796CB0B81ADFF46A8C70632F00C762EFAC`.
- Artifact checks confirmed that the startup guard, authenticated control channel, `security.visibility`, `window.owner`, lock visibility gate, native Windows owner-window extension, and disabled official updater are present in the output. The compatibility contract, lock-screen static contract, artifact inspection, six startup-guard/control-protocol unit tests, and the complete root-project security regression passed.
- The real-window report is `.tmp/signal-source-ui/2026-07-13T15-37-35-571Z-2476117e/artifacts/report.json`. It ran for 57.216 seconds and passed 14/14 assertions. It directly confirmed isolated-data startup, one-time launch-credential acceptance, execution of the selected source-built `Signal.exe`, control-channel authentication, the Signal main window's `GW_OWNER` relationship to the translator, real visibility, hide on translator minimize, show on restore, hiding every Signal window under the main-process lock gate, and target Signal child exit after translator exit.
- In that Win32 run, the Signal PID was `2336`, the Signal HWND was `722524`, and the translator/owner HWND was `13173990`. The visible screenshot `signal-visible.png` has SHA-256 `F4ED4878D969827FE0A24AC4A685943AA42447CFC09AD8D1925044822F667D15`; the lock-gate screenshot `signal-gate-locked.png` has SHA-256 `48CA7C167A9D82C403296EB41952AF540462D9C9BD0E910CB7B9C402B8945128`.
- The UI test writes only under `.tmp/signal-source-ui` and uses the `000000000` test sentinel. It did not read a customer profile, replace the production `.runtime/signal-desktop`, mutate the original clean release, package or install anything, or consume `006` or any nine-digit suite ID.

Problems encountered and resolved in this phase:

- The system Node version and C++ toolchain initially did not meet the official requirements. The build now uses isolated, pinned Node `24.15.0` with the complete official Windows build toolchain.
- The first real-UI path failed before launch because the prepared directory name and marker version format were compared inconsistently; validation now uses the actual `v8.17.0` directory. A later run named isolated data `client-data`, which the guard correctly rejected with the missing-launcher dialog. Renaming the isolated root to the allowed `maoyi Data` produced `credential-accepted` and 14/14 passing assertions. The dialog comes from the launch-credential guard, not from development mode itself; it is expected when the modified Signal is launched directly.
- Translator shutdown previously used `child.killed` as a liveness test. It now waits on exit state and the authenticated PID, force-terminates only after the grace period, and keeps the workspace locked with an error when exit cannot be confirmed.
- Theme IPC previously called the Electron runtime API with invalid `setTitleBarOverlay(false)`. The runtime call is removed, creation-time `titleBarOverlay: false` remains, and a static regression contract prevents reintroduction. Build and contract tests pass; actual clicks through both themes remain a real-UI check.
- After the user closed the ordinary development app, a full Windows process query found no maoyi, Electron, or Signal process. The earlier observed processes belonged to the user's manually opened development session, not the isolated acceptance harness.

Still incomplete or not confirmed:

- `script.execute` remains a transitional command while unlocked. It is rejected while locked, but the final typed-only command allowlist is incomplete.
- Full Signal source type checking still has one official-baseline error: `ts/windows/main/attachments.preload.ts` cannot resolve `fs-xattr`. The supported claim is “build and targeted tests pass,” not “full type checking passes.”
- The successful report formally tracks one test profile/PID. Complete multi-profile operation, SG01/SG02, contact A/B/A, a linked account, translated bubbles, Chinese composer guarding, encrypted-cache restoration, unread state, and notifications still require real acceptance.
- The lock test invokes the main-process visibility gate directly. It does not test the sidebar Lock button, six-digit-plus-two-letter password, offline setup/reset, unlock, or a real 15-minute wait.
- Locked state is not persisted as a restart gate. Translator renderer readiness still releases the startup visibility lock, so killing and restarting can bypass “continue requiring the password.”
- The 15-minute idle timer observes translator-renderer activity only; activity inside the external Signal window does not reset it.
- The control bridge has no heartbeat-ack timeout. A failed owner attachment for a newly created secondary Signal window is not tracked as a permanent per-window block. The translator does not yet consume `window.owner-attached` and `transport.error` into explicit health state.
- Lock acknowledgement counts Electron `BrowserWindow` instances, not arbitrary native dialogs/HWNDs. Remote screen-capture protection and screenshot blocking are separate capabilities and are not implemented in this phase.
- The complete dragging, resizing, theme, unrelated-foreground-app z-order, and CPU/memory matrices remain incomplete.
- The current working-tree changes have not been committed to Git or pushed to GitHub.

The user-defined forward-port gate was “clean v8.17.0 build plus first window control.” That gate is now complete, so the same phase-one patch set is moving to v8.18.0. v8.17.0 remains a verifiable rollback baseline, and none of the incomplete items above become complete merely because the forward port has started.

## 2026-07-13 Signal v8.18.0 Phase-One Forward Port Completed

- Added an independent v8.18.0 baseline, compatibility contract, and patch series. The official ZIP SHA-256 is `A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66`. The three patches are byte-identical to v8.17, while the version-bound v8.18 patch-set SHA-256 is `A4727D862E263B263B9CBAEA731ECF34D2553C7C223D762EEF9748E7792C136F`.
- The source experiment, compatibility, artifact, and real-window tools now accept explicit `--version 8.18.0`; omission still defaults to v8.17.0. The translator trusts only the exact patch-set hash for each of the two versions plus the exact executable SHA-256 supplied for every launch. Unknown versions, directory mismatch, path escape, and patch-set replacement are rejected.
- The first restricted build waited about ten minutes before dependency installation, with no network connection and no `node_modules` directory. All six build preflight checks had already passed, proving that development tools were not missing. The identical network-enabled rerun reused 1,955 packages from the verified local cache, downloaded only two missing packages, installed 1,958 packages total, and completed native modules, source generation, Rolldown, and the Electron Windows directory build.
- The v8.18 `Signal.exe` is 227,025,408 bytes with SHA-256 `CC83454439A7093730661E6BEEDEC8275A167EF22FC1FEC102D165BA17075710` and Authenticode status `NotSigned`. `app.asar` is 31,472,929 bytes with 1,114 entries and SHA-256 `1DE70B075E7AEEDAD89F5D8DD379BC0B0AC7C02323A2612846B4B047DE64F79E`. `windows-ucv.node` is 224,768 bytes with SHA-256 `E902F13DEB8B5C259E515AC3EBA8EB1D87907505AB3E34CA8B0F5669A57E51B4`.
- The built v8.18 `package.json` is byte-identical to the official reference source; both have SHA-256 `E06CFE0A8966FA25AEFBA09CA07F837622C633786E1D1A5F36B4216F0AA610C4`. Artifact inspection confirmed all three bundle groups and the startup-guard, authenticated-control, owner-window, and lock-gate markers. All six v8.18 startup-guard/control-protocol unit tests passed.
- Full v8.18 source type checking entered the compiler and still produced only the official-baseline missing-`fs-xattr` error; it is not recorded as passing. The complete root-project security regression now checks both v8.17 and v8.18 compatibility contracts and passed.
- The v8.18 real-window report is `.tmp/signal-source-ui/2026-07-13T16-12-24-518Z-1c771649/artifacts/report.json`. It ran for 25.653 seconds and passed 14/14 assertions. The Signal PID was `1116`, the translator PID was `13068`, the Signal HWND was `13763814`, and the owner/translator HWND was `2950772`.
- The visible screenshot has SHA-256 `0C2590DCBB1199D7BBE6A053FC22CEB7F8DBF9FC6B325FE115738C28871C80FB` and visibly shows Signal's linking screen filling the workspace. The lock-gate screenshot has SHA-256 `E9F16C827CA9B95C5D47A172AF2B1DB7B1074FBB315DF16FDD56A625CD0D9BC5` and visibly contains no Signal content. After the test exited there was no v8.18 GUI, Signal, or Electron process, and the original build directory had no real runtime-binding file.
- Local source comparison confirms that v8.17 already contains complete poll creation, single/multiple choice, vote/retract, statistics, voter detail, and poll termination. v8.18 primarily enables poll creation in individual chats and improves poll-source notification and disappearing-timer handling. It must not be described as the first version to add polls.
- This pass did not replace `.runtime/signal-desktop`, read a customer profile, package or install anything, consume a suite ID, create a Git commit, or push GitHub.
- The v8.18 phase-one forward port is complete, but the v8.17 worklog gaps for `script.execute`, restart lock gating, Signal-window activity not resetting idle time, heartbeat timeout, per-secondary-window owner state, native-dialog coverage, remote-capture protection, and the full capability matrix remain. Read-only review has started for stable v8.18 message events, batched cache lookup, and React translation slots; those capabilities are not yet claimed as source-integrated.

## 2026-07-13 Signal v8.18.0 Phase-Two First Slice Completed

- Added the fourth source patch, `0004-maoyi-source-translation-cache-bridge.patch`. Its SHA-256 is `E1A261466D7D9F6C38896C7236C9E27067871320123F0BE86EE00A09ADF8F7A8`; the aggregate four-patch SHA-256 is `384B2C5DBA7AD39154E19618C36B5D9AE1ACD53279719F8BE561D49288B0605D`. The v8.17 three-patch rollback baseline remains unchanged.
- Patch 0004 contains exactly 24 expected source, test, and style files: 11 modified and 13 added. It excludes `node_modules`, generated CSS, protobuf output, release artifacts, and customer data. It adds the strictly typed `message.snapshot.request`, `conversation.changed`, `message.visibleBatch`, `translation.cacheResultBatch`, and `translation.cacheResultApplied` path.
- Signal permits only the attached main-window renderer to emit bodies while authenticated, unlocked, genuinely visible, and allowed to expose windows. The current projection uses a deterministic “contains at least one Latin letter and no CJK character” condition, not an English-language detector. Batches are capped at 100 items/768 KiB. Lock, hide, disconnect, reload, or close clears the Signal renderer LRU, bodies, runtime, and request correlations without deleting the machine-bound encrypted disk cache. The main-process ledger is capped at 128 requests for 30 seconds with one-use state transitions; an auxiliary renderer cannot clear trusted state through IPC.
- Cache results must exactly match profile, conversation, message UUID, normalized full source, and compatible hash. Signal's in-memory LRU is capped at 1,500 entries/15 MiB, and the React translation slot renders text nodes without writing the Signal database or logging message bodies. The main translator responds with existing encrypted-cache hits only and does not call DeepSeek on this path.
- Root-process cache response handling received a further security closeout: empty translations, prompt leakage, source-equal text, and historical translations unsuitable for back-translation are treated as misses. An invalid or protocol-oversized legacy entry drops only that entry without exposing its body or breaking the whole batch.
- Each authenticated `appId` has an independent limit of eight genuinely unfinished asynchronous lookups. Conversation changes, hide, or lock clear request correlations, but the real asynchronous work continues to occupy the count until it settles, so cross-conversation clearing cannot bypass the limit. The 128-entry replay ledger never evicts responding work and rejects a new entry when all 128 are responding. Failure or saturation sends a valid empty `translation.cacheResultBatch`, not event-direction `type:error`, preventing a triggerable disconnect denial of service; the `test:signal-cache-response` automated contract covers and passes these boundaries.
- This pass fixed and tested A/B switch races, same-ID body edits, case-insensitive UUID duplicates, O(n-squared) batching, inability to retry after a rejected transport send, missing A/B/A republish, React reads bypassing true LRU touches, and translation/metadata overlap.
- The Chinese-to-English punctuation contract is fixed as `你确定吗？` to `Are you sure?`: the source question mark may not be lost; the output is exactly one ASCII `?`, full-width `？` is normalized, `??` is collapsed, and the rule is not reversed into an English-to-Chinese test. This contract lives in the main translator's composer path in `electron/shared.ts` and `electron/main.ts`, and `tools/test-composer-question-mark.mjs` passes; the Signal source-level composer guard remains unimplemented.
- The first full build stopped because restricted networking denied npm downloads. The authorized rerun used the exact lockfile and succeeded, reusing 1,957 of 1,958 packages from local cache. This was not incomplete source or missing development tools.
- Windows global `core.autocrlf=true` initially converted all 24 clean-replayed files to CRLF. The patch application tool now pins `core.autocrlf=false`. A second independent preparation from the official ZIP proved all 24 files byte-identical to the formatted source with zero CRLF files.
- Artifact inspection initially expected a separately named `windowController` chunk, while patch 0004 caused the bundler to merge window control into the `messageBridge` chunk. The check now verifies both the real bundle content and Phase2 markers, avoiding a false missing-feature report.
- The first Phase2 GUI rerun exposed a test race: after automatic login, the harness clicked login again, and the late second login reset the Signal workspace to the application center. The harness now avoids duplicate login once the application center is visible; product code was not changed for this. The next report, `.tmp/signal-source-ui/2026-07-13T17-48-15-353Z-94440bbf/artifacts/report.json`, passed 14/14 assertions in 20.812 seconds.
- A deeper cause of later acceptance failure was that the harness checked only the target element and ignored hidden ancestors, misclassifying an invisible application center as entered. It now checks the full ancestor chain and actual layout visibility, permits one bounded entry click, and records staged failure diagnostics containing no account data, message bodies, secrets, or credentials.
- The final LF source replay, full build, and artifact inspection passed with all three output hashes unchanged. `Signal.exe` is 227,025,408 bytes with SHA-256 `01136BB24024D0D1E5BA0B20357D94F0DB73F3E3A1D3461260462F74400D7C80`; `app.asar` is 31,490,598 bytes with 1,115 entries and SHA-256 `9C6579AC615F10067382DF86DD6D1558FCE2E9B9FBD2C211F1BFE4065D57AF86`; `windows-ucv.node` is 224,768 bytes with SHA-256 `A4E10BF7A7524416950423AE40075DC2BC469DC3BF0D5CBCB6E873F27F8E21DA`.
- All 34 targeted Maoyi Signal tests, 380 static rules across 23 files, Prettier, Stylelint, both compatibility contracts, artifact inspection, and the complete root security regression passed. The latest real-window report, `.tmp/signal-source-ui/2026-07-13T19-13-57-209Z-55d629ad/artifacts/report.json`, passed 14/14 assertions in 33.042 seconds. The visible capture SHA-256 is `525F0B77875E9E4B0EADC39969E51EF1942555F4C768C9C834D6BF3183EC8D18`; the lock-gate capture SHA-256 is `531491CED27FA6B8C064C8ECE7037114FAE2C6BED582E71C9F0EBB85338C7100`.
- The `test:signal-transitional-status` automated contract passes. Manual inspection of the latest lock-gate capture confirms that the stale “message scan failed” banner is gone and that no Signal window, QR code, or chat content is visible; only normal Signal-started and input-listener-installed status remains. This visually proves the stale-status fix and the invoked lock gate, not an unimplemented automatic remote-control mask.
- Full Signal source type checking still reports only the existing missing-`fs-xattr` error in `attachments.preload.ts`, so it is not recorded as passing. Cached bubbles in a real linked account, real SG01/SG02 and contact A/B/A switching, source-level Chinese composer guarding, live translation on cache misses, exact unread/notification handling, removal of transitional `script.execute`, automatic remote-control masking, and the complete theme/drag/CPU/memory matrix remain incomplete; the phase-one gaps for restart lock gating, Signal-window activity resetting idle time, heartbeat acknowledgement timeout, per-secondary-window ownership, explicit owner/transport health state, native-dialog coverage, and remote-capture protection also remain incomplete.
- Final delivery acceptance keeps `v8.17.0` as the reproducible rollback baseline and uses `v8.18.0` as the current delivery baseline. Each retains its own manifest, patch set, and evidence and must not overwrite the other.
- This pass did not replace `.runtime/signal-desktop`, read a customer profile, build an installer, consume `006` or any other suite ID, create a Git commit, or push GitHub.

## 2026-07-13 Signal v8.18.0 Phase-Two Second Slice Completed

- Added the fifth reproducible source patch, `0005-maoyi-realtime-message-translation.patch`, SHA-256 `8E7DFAB5EAC76B075826BF4382BBEFFE59D370FBE48A3C2FBF45D59E4D7F9ABA`; the aggregate five-patch SHA-256 is `0E268344E842B0939D1B75E3D92BFB206C562112E2C2ED535F6670766B426417`. The patch contains only nine expected source/test files, all byte-identical between the development tree and clean replay.
- Signal source emits a strict `message.added` event from the official `MESSAGES_ADDED` incremental path only for an active single message that the reducer actually added to the current conversation. History, background conversations, duplicates, attachments, polls, CJK-only bodies, and oversized bodies are rejected.
- The main client now has a cache-first bounded live-translation queue: global concurrency 24, per-profile concurrency one, pending limit 128, and retries only at 5 and 30 seconds after the initial failure. Task identity binds profile, conversation, message UUID, compatibility hash, and SHA-256 of the complete normalized source.
- The main client independently recomputes the body hash and enforces normalization, 4,000-character, Latin, and CJK semantic rules. A useful translation must be saved successfully to the machine-bound encrypted cache before requesting a fresh snapshot; invalid translations are neither saved nor refreshed.
- Lock, hide, conversation switch, disconnect, and client replacement clear queued/retry/refresh work and abort in-flight network calls. Eligibility is rechecked after every asynchronous stage, so stale work cannot continue to the network, cache save, or refresh. Dynamic tests cover cache-hit zero API, save ordering, deduplication, concurrency, retries, rejection of item 129, and asynchronous cancellation races.
- A fresh source tree prepared from the official ZIP completed serial replay of all five patches and a full Windows build in 85.2 seconds. Targeted Maoyi tests passed 39/39, including 21/21 focused new-chain tests; Oxlint reported zero errors and zero warnings, and Prettier, compatibility, artifact, and complete root security checks passed. Full source type checking still has only the existing `fs-xattr` baseline error and is not recorded as passing.
- Final artifacts: `Signal.exe` SHA-256 `4C2CA50F29E883BA55EDFFF45E8A8CEF8E71EBC8F2E5C24E8BEAB4FBEAF01852`; `app.asar` SHA-256 `F103D60718D0D9CBA276102BB8382B08F6F391D51DF3E53BF0F6960E414F9BA7`; `windows-ucv.node` SHA-256 `582751A922C78A2C50234F666F06B190ABA5073BAD0A32FF6E783B0E4404DF8F`. The artifact contract independently reproduced these values.
- The latest real-window report, `.tmp/signal-source-ui/2026-07-13T20-42-15-586Z-355a12fb/artifacts/report.json`, passed 14/14 assertions covering the exact source artifact, launch credential, authenticated control channel, Windows owner relationship, minimize/restore, lock-gate hiding, and process-exit coupling.
- Still incomplete or not human-confirmed: translated UI after a real linked account receives a new English message, visible-history cache-miss backfill, manual refresh, source-level composer guarding, exact unread/notification events, retirement of the legacy message-DOM path, complete multi-profile/theme/drag/CPU/memory matrices, and the previously recorded restart lock gate, idle timing, heartbeat, secondary-window, and remote-capture protections.
- This pass did not replace `.runtime/signal-desktop`, read a customer profile, package or install, consume `006` or another suite ID, create a Git commit, or push GitHub.

## 2026-07-14 Suite 006 Packaging Startup and Issuer Isolation Repair

- Packaging pitfall one: `LoadBrowserProcessSpecificV8Snapshot` was enabled without packaging `browser_v8_context_snapshot.bin`, so the client, issuer, and prompt generator exited before application JavaScript ran. This fuse must remain disabled unless that snapshot is deliberately generated and packaged, and delivery verification must actually start all three unpacked applications.
- Packaging pitfall two: the issuer reused the `maoyi` client data directory. Existing `issuer-state.bin` data therefore made a new suite show password login on its first launch and could cross-contaminate suite vaults.
- Packaged issuers now isolate state under `AppData/Roaming/MAOYI AUTHORIZER/<suiteId>/` and bind the unlocked vault to the embedded suite ID, key ID, and public-key SHA-256.
- The security regression now includes the issuer-suite isolation contract. Packaged-output verification also reads the embedded issuer identity from `app.asar` and matches it to the suite being built.
- Suite 006 was repaired with the existing suite ID `169855092`; no new suite ID was generated. Before the final issuer's first launch its suite-scoped directory did not exist. The launch created only an uninitialized `issuer-state.bin` and no `issuer-vault.dat`; the user manually confirmed that the first launch shows password setup and that the issuer is normal again.

## 2026-07-13 Signal v8.18.0 Bubble-Translation Stable Milestone (Human Accepted)

- Added the seventh source patch, `0007-maoyi-incoming-auto-translation-stability.patch`, SHA-256 `F260FAC184A6080E4055CF2BEA8205987841430B8DCF4E834DD0081594656B02`; the aggregate seven-patch SHA-256 is `BCE9EE003DF01337EDB941CE4B30EEDDE192768558FE185A919662A9928CD389`.
- Fixed real incoming messages with `contact: []` being misclassified as embedded contacts, incremental messages being silently dropped after a visible-snapshot revision, and visible cache misses not entering bounded live translation. Cache misses for old, currently visible, and new messages now use the existing gated, rate-limited, cancellable DeepSeek queue.
- All 22 focused Signal tests passed. The complete root `test:security` suite passed, covering lock screen, question-mark preservation, browser compatibility, Signal cache response, live translation queue, source compatibility, licensing, runtime security, encrypted cache, sensitive sends, and Electron Fuses.
- Offline incremental packaging completed from the full local Signal v8.18.0 source, local Node/pnpm/Electron, and the existing dependency tree. It used no network download, did not reinstall the 1,958 dependencies, and used no SUBST or mapped drive. Final packaging took 17.1 seconds.
- Final artifacts: `Signal.exe`, 227,025,408 bytes, SHA-256 `2DFD1777BA378AB0992B442C3E220815875E9A2EE92BB2CAA076BBCB13EC1058`; `app.asar`, 31,497,097 bytes with 1,115 entries, SHA-256 `ADB6A713A68F1CB60C3C517E7E0675C4D2E135FB346457F7FF422B18978F39F7`; owner native add-on SHA-256 `193A22D772ED9FBFB61B14D3F2923EDB19861D151DD9BA605CE05FB57B61FEED`.
- The new runtime replaced only the isolated acceptance runtime; the prior runtime was preserved as `release.previous-20260713T223822-0007`. Login data, acceptance authorization, and runtime binding were preserved. The formal `.runtime/signal-desktop` was not replaced, and no 006 installer suite was generated.
- The user human-accepted checks 1–4: old and new incoming English bubbles automatically show Chinese; incoming-bubble ↻ works; outgoing English bubbles automatically translate; and outgoing-bubble ↻ still works.
- This milestone proves the Signal bubble-translation path only. Previously recorded automatic remote-control masking/capture protection, restart lock gating, Signal activity resetting idle timing, heartbeat acknowledgement timeout, per-secondary-window ownership, native-dialog coverage, exact unread/notification handling, and the complete multi-profile/theme/drag/CPU/memory matrix remain incomplete unless separately accepted.

## 2026-07-13 Supplemental Workspace Interaction Archive After the Stable Baseline

- This section is supplemental UI polish and does not change archive priority. The primary milestone remains the previously recorded and committed reproducible Signal v8.17/v8.18 source baselines, controlled startup and window security, lock-screen and send integrity, encrypted translation cache, bounded live translation, automatic/manual bubble translation, complete security regression, and human acceptance. The UI work is secondary polish.

- Added a Bitcoin-icon button below Lock Screen in the workspace sidebar. Every process restart defaults to the expanded state, and the state is not persisted. The visible label describes the current chat-window state: “展开” while the header is visible and “折叠” while it is collapsed.
- The control removes/restores the complete 104px top header. When collapsed, the logo, Chinese/English branding, version, memory status, translation feedback, Refresh Window, and Change Theme disappear with no residual blank row; the multi-profile tabs and chat area move upward. Minimize, maximize, and close remain in their existing fixed top-right floating layer and are never part of the collapse.
- Home, Lock Screen, and Expand/Collapse use equal 88px sidebar rows. The Bitcoin control is visually shifted downward by 5px. State changes only swap the “展开/折叠” label and do not add a selected highlight; existing hover feedback remains in both themes.
- The inner Bitcoin artwork was extracted directly from the user's replacement `比特币.png` by removing its solid white background into `src/assets/bitcoin-glyph-cutout.png`, preserving the original orange shape. The source reference image is not included in project Git. The UI draws the outer ring independently, and it always remains stationary.
- After clicking the button labeled “展开” into collapsed mode, the inner Bitcoin artwork repeats a `3s → 10s → 15s` wait sequence. Each trigger rotates the artwork three turns (1080°) around its vertical axis over 2.67 seconds and returns upright. The next wait begins only after the prior three-turn burst finishes. Clicking the button labeled “折叠” restores the header, immediately cancels timers, stops the animation, and resets the artwork upright.
- Added `tools/test-workspace-header-collapse.mjs` to the complete security regression to lock zero-height collapse, floating window controls, restart defaults, equal spacing, direct-cutout asset, label semantics, three-turn bursts, and the 3/10/15-second sequence. The build and focused contract pass. No installer was generated, no 006 suite ID was consumed, and nothing was pushed to GitHub.
