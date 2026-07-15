# Client Security Hardening Record

## Completed on 2026-07-12

- Electron is pinned to `43.1.0`. Production dependencies are limited to two pinned address-validation libraries, and `npm audit` reported zero known vulnerabilities.
- The main window now enforces sandboxing, context isolation, CSP, navigation restrictions, WebView origin rules, permission denial, dangerous-download filtering, and IPC sender validation.
- Packaged applications disable RunAsNode, NODE_OPTIONS, Node inspection, and related Electron Fuses while enabling ASAR integrity and OnlyLoadAppFromAsar.
- The renderer no longer receives the service secret. Customer packages exclude trial secret files, issuer private keys, and issuer entry points.
- The obsolete `prepare-trial-config.cjs` tool that extracted a plaintext key from legacy configuration is removed and covered by a regression gate.
- Licensing now uses `DFM2 + DFLIC2`: DPAPI protects the device X25519 key, X25519/HKDF-SHA256/AES-256-GCM encrypts the payload, and the suite Ed25519 key signs the complete envelope.
- Disk translation cache now uses `TranslationCache/v3`: each record has independent AES-256-GCM encryption, and the DPAPI-protected key is bound to the suite and data root. Legacy plaintext cache is deleted rather than migrated.
- The main renderer and fingerprint-browser pages no longer persist translation plaintext in `localStorage`. Page-side rendering keeps only an in-process hot cache capped at 1,500 entries or 15 MB; restart recovery is batched from the machine-bound encrypted `TranslationCache/v3`.
- The main-renderer legacy key is removed at startup, WhatsApp/Telegram keys are removed when their WebViews become ready, and each Signal key is removed on that instance's next authorized launch. Cleanup does not migrate translations or clear platform login state.
- Automatic enterprise-chat-asset writes are removed and cannot trigger duplicate translation calls.
- Signal control uses a random local port, a 32-byte challenge, HMAC-SHA256, bidirectional sequence numbers, a 1 MiB frame limit, and at most 64 control sockets. The launch credential is single-use and valid for 10 seconds.
- Normal translated sends require a single-use translation approval and verify the newly created outgoing bubble after dispatch.
- Standalone numeric payment accounts and USDT addresses use a two-Enter transaction: trusted confirmation first and exact dispatch second. The approval is single-use and expires after 120 seconds.
- Permanent lockout, full data cleanup, and uninstall after five consecutive invalid license codes remain enabled without a development bypass.

## Explicitly Excluded

- Item 10: the modified bundled Signal executable's Authenticode HashMismatch is not addressed in this pass.
- Item 12: Authenticode signing for the client installer and issuer is not addressed in this pass.
- No installer was built and no suite ID was consumed. Source is archived in this local pre-refactor Git recovery point, and nothing was pushed to GitHub.

## Real Acceptance Still Required

- Verify translated second-Enter dispatch and post-send bubble comparison in real WhatsApp, Telegram, and Signal sessions.
- On all three platforms, verify numeric accounts, TRC20, ERC20/BEP20 network selection, and Solana through first confirmation, second dispatch, and invalidation after any content change.
- In a future full-suite output, verify issuer-side `DFLIC2` issuance, client activation, restart verification, and actual uninstall on the fifth invalid code.
- Verify foreign Signal and full data-root initialization on a second physical Windows computer.

## Serverless Boundary

- Local hardening blocks ordinary copying, remote platform scripts, and unauthorized Signal launch, but it cannot absolutely defeat malware that already has Windows administrator rights or current-user process-injection capability.
- Without code signing, an attacker able to replace both the executable and application package may bypass integrity checks tied to the original application. This is an explicitly retained risk for this pass.
- Dynamic Signal script execution is currently limited to the local main renderer protected by ASAR integrity; remote platform pages cannot invoke it. Migration to fully typed commands remains defense-in-depth work.
