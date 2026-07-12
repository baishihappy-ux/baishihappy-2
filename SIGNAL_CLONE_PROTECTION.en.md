# Bundled Signal Foreign-Clone Protection

## Objective

This feature prevents the project-controlled Signal runtime from being opened independently or reused after it and its signed-in data are copied to another computer.

- Direct launch on the original computer: show "Launcher missing. Start Signal from maoyi," exit immediately, and preserve local data.
- Launch on another computer: show "Launcher missing. Initializing," reset application data in the copied environment, and exit.
- Only maoyi with a valid `license.dat` and machine-code authorization may start bundled Signal.
- Signal must not load its original main module, account database, or chat window before the guard succeeds.

## Device And Data Binding

On the first authorized local runtime preparation, MAOYI creates:

- `device-identity.dat`: the Ed25519 device private key, device random secret, and one-time username binding. Private fields are protected by Electron `safeStorage` (Windows DPAPI).
- `runtime-binding.dat`: stored at the `maoyi Data` root. It contains a signed public binding payload and an equivalent payload protected by MAOYI's DPAPI context.
- `resources/df-runtime-binding.dat`: the bundled Signal runtime sidecar, mirrored from the root binding when the installation directory is writable.
- `SignalInstances/Signal-<profileId>/df-instance-binding.dat`: a signed binding for each Signal profile.

The runtime binding contains:

- `productId`
- `suiteId`
- `keyId`
- `installationId`
- `dataRootId`
- `machineCodeHash`
- `hardwareHash`
- Device public key
- Creation time

The device private key never enters Signal, command-line arguments, logs, renderer pages, or runtime-binding files. Signal validates bindings and launch credentials with the public key and recalculates the hardware digest from Windows `MachineGuid`. A different hardware digest is classified as a foreign copy.

## State Machine

1. `FRESH`: no binding and no trusted historical data. Standalone Signal performs an empty initialization and exits; an authorized MAOYI client may provision the binding. If historical data exists but its binding is missing, Signal blocks and preserves the data so the MAOYI main process can make the final decision using its DPAPI device identity.
2. `LOCAL_AUTHORIZED`: hardware digest, signatures, suite, profile, and one-time launch credential are all valid; Signal may load its original main module.
3. `LOCAL_DIRECT_BLOCKED`: the local binding is valid but no valid launch credential exists. Signal exits without deleting data.
4. `FOREIGN_CLONE`: invalid signature, DPAPI decryption failure, hardware mismatch, or suite/machine mismatch triggers full initialization.
5. `RESETTING`: processes using the target data root exit, then the copied application data root is deleted.
6. `RESET_COMPLETE`: the storage pointer and copied Signal runtime binding are removed; the next launch behaves like a fresh installation.
7. `RESET_FAILED`: access stays denied, initialization reports failure, and the next launch detects and retries the reset.

A credential failure alone never triggers deletion. When the local runtime binding is valid, a missing pipe, timeout, profile mismatch, or invalid credential signature only exits Signal. This prevents accidental deletion of the original signed-in state.

## Signal Launch Handshake

1. MAOYI confirms that client authorization is still valid.
2. MAOYI creates a random Windows named pipe: `\\.\pipe\maoyi-signal-<parentPid>-<128-bit random>`.
3. MAOYI starts only the bundled Signal runtime, with no fallback to official Signal.
4. The Signal guard synchronously reads the named pipe before the original `app.asar` entry point.
5. MAOYI generates a `256-bit` random nonce and signs the launch credential with the Ed25519 device private key.
6. The credential binds `suiteId + installationId + dataRootId + profileId + Signal PID + issuedAt + expiresAt + nonce`.
7. Credential lifetime is exactly `10,000 ms`, and the named-pipe server accepts one connection.
8. Signal validates the credential with the device public key, then loads the original `bundles/main.js`.

The command line contains only the random pipe address. It never contains the credential, private key, or service secret.

## Full Initialization Scope

The reset target is the entire application data root on the copied computer, including:

- Signal profile sign-in state and databases
- WhatsApp and Telegram fingerprint-browser partitions and sign-in state
- Translation cache
- Profile configuration, lock PIN, client account, license, and device identity
- Legacy enterprise-asset directory, runtime state, and local logs
- `maoyi Launcher/storage.json` when it points to the target root
- The matching `df-runtime-binding.dat` runtime sidecar

Installer and application binaries remain. Manually exported Word files outside the application data root are not scanned or removed. Deletion is logical filesystem deletion and is not represented as forensic physical erasure on SSD storage.

## Deletion Safety Boundaries

- Automatic deletion accepts only a local absolute directory named `maoyi Data` or the compatible legacy name `maoyi`.
- Drive roots, UNC network paths, and symbolic-link roots are rejected.
- A reset plan is valid for `5 minutes` and contains a one-time `resetId` plus a root marker.
- The reset worker waits up to `15 seconds` for the parent process to exit.
- File operations retry at `0/250/500/1000/2000/4000/8000 ms`.
- Recursive deletion does not follow symbolic links or directory junctions.
- Automatic deletion is disabled by default when development uses a `MAOYI_USER_DATA_DIR` override. Isolated tests must explicitly enable it.

## Packaging Rules

- `package:win` forcibly runs `prepare:signal-runtime` before building, reinjecting the early Signal guard.
- Customer packages exclude `app.before-signal-control.asar` and its backed-up `app.asar.unpacked` native modules, so the unguarded Signal backup is not delivered.
- Customer packages exclude the development machine's `df-runtime-binding.dat`; the customer machine creates its own binding after its first authorized launch.
- Packaged clients do not set development diagnostic variables and do not create guard diagnostic files.
- This implementation does not automatically build an installer. Packaging runs only after an explicit user request.

## Verified And Unverified Scope

Actually verified with isolated workspace data:

- Authorized MAOYI launch returned `credential-accepted`; Signal created its database and logged main-window `ready-to-show` and show events.
- Original-machine standalone launch returned `local-direct-blocked`; the process exited while the original data root, binding, and database remained.
- Signal loaded a fabricated foreign data root and deleted that complete temporary root without deleting the original isolated root.
- The MAOYI main process loaded fabricated foreign data and deleted that complete temporary root before exiting.
- Automated tests cover binding signatures, profile isolation, PID binding, the `256-bit` nonce, `10-second` expiration, tamper rejection, named-pipe transport, and bounded full-root deletion.
- The Signal patch was rebuilt from a clean backup. Repeated patching now reports `changes: []` and leaves the `app.asar` hash unchanged. The guarded control test validates native modules, handshake, window control, and automatic shutdown.

Not yet verified:

- The real hardware-mismatch path after copying bundled Signal and profile data to a second physical Windows computer or VM.
- All five paths in a newly generated installer: first authorization, local binding, authorized launch, standalone launch, and foreign-machine copy.
- A clone of the entire Windows user profile together with its DPAPI master keys. Per the user's decision, that threat boundary is deferred.
