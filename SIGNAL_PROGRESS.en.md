# Signal Progress Archive

## 2026-07-07 Initial Multi-Instance Track

Confirmed:

- A local official Signal Desktop executable was available during early research.
- The competitor embeds its own Signal runtime under `look-world-pro-embed\signal\Signal.exe`.
- This project added an initial Signal launch path that starts `Signal.exe` with a per-profile `--user-data-dir`.
- Closing a Signal profile must stop the corresponding Signal child process and remove the matching `signalDataDir` only when the profile is deleted.
- `npm.cmd run build` passed during that stage.

Conclusion:

- Unmodified official Signal Desktop did not provide enough confidence for true independent multi-instance support.
- Matching the competitor required a dedicated runtime track: embedded Signal Desktop, `appId`-based isolation, and a WebSocket control channel.

## 2026-07-07 Multi-Instance Breakthrough

Confirmed:

- Signal `app.asar` has integrity checks.
- Patching only `app.asar` triggers integrity mismatch errors.
- The successful patch flow must keep the Signal package and embedded executable integrity hashes in sync.
- The patched runtime can launch multiple Signal instances with separate data directories.

Current launch arguments:

```text
--df
--user-data-dir=<profile-specific data directory>
--appId=Signal-<profile.id>
--title=<profile name>
--wsPort=<main process control port>
--windowMode=embed
```

## Path Argument Finding

Confirmed:

- Manual PowerShell `Start-Process` tests can break paths containing spaces if arguments are composed incorrectly.
- The app's Node `spawn(executable, args)` approach passes paths with spaces correctly when each argument is supplied as a separate array item.

Rule:

- Do not judge project launch correctness from ad hoc PowerShell argument strings.
- Keep Signal launch arguments as structured Node `spawn` arguments.

## Process Close Reinforcement

Implemented:

- `stopSignalProfile` does not rely only on the recorded main child PID.
- On Windows, it matches `Signal.exe` command lines by the profile's `--user-data-dir` and force-closes the whole process group for that instance, including GPU, renderer, and network child processes.
- When removing a Signal profile, pass the known `signalDataDir` into the stop path before removing the config entry.

## Signal Control Channel

Confirmed:

- Main process exposes a Signal WebSocket control service.
- Signal launch arguments include:
  - `--appId=Signal-<profile.id>`
  - `--wsPort=<port>`
  - `--windowMode=embed`
- The patched Signal runtime supports:
  - `window.show`
  - `window.hide`
  - `window.bounds-changed`
  - `shutdown`
  - `heartbeat`
  - `script.execute`

Verification scope:

- `npm.cmd run build` passed.
- `node tools\test-signal-control-channel.cjs` passed for the control channel.
- This is not the same as actual UI behavior verification.

## Workspace Overlay

Confirmed:

- Main process added `signal:set-workspace-bounds` for syncing the Signal workspace rectangle.
- Main process added `signal:hide` for hiding a Signal profile window.
- Renderer reads the `.runtime-web-main` workspace rectangle and sends it to the main process.
- Main process converts the renderer rectangle to screen coordinates and sends `window.bounds-changed` plus `window.show`.
- Switching away from Signal sends `window.hide`.

Current limitation:

- This is a top-level window overlay model, not native Windows `SetParent` child-window embedding.
- The competitor also used a top-level window model, so this is intentional.

## Control Channel Disconnect Fix

Confirmed:

- Force-closing a Signal child process can trigger `ECONNRESET`.
- The main process must listen to the control socket `error` event to avoid a main-process JavaScript error dialog.

Implemented:

- The Signal control upgrade handler now attaches socket error handling and cleans up connection state.

## Database Startup Error Handling

Implemented:

- Before launching a Signal profile, the app checks instance logs for database startup/decryption corruption indicators.
- If corruption is detected, it stops that instance, renames the old data directory with a `.broken-*` suffix, and recreates a clean directory.

Verification scope:

- Build passed.
- A repaired instance was launched in a short test and did not produce the same database startup error in that observation window.

## 2026-07-08 Display Stabilization

Confirmed by user:

- Switching Signal multi-open tabs no longer makes all Signal windows disappear.
- Minimizing and restoring the main app no longer loses the current Signal window.
- Flicker stopped after reducing sync bursts and removing redundant focus calls.
- CPU spikes dropped from earlier 100% behavior to much lower momentary usage.
- Signal `+` new multi-open works after hiding Signal while blocking modal dialogs are open.

Rules:

- Do not use external PowerShell loops for hot-path Signal display control.
- Do not clear pending workspace bounds on minimize/hide.
- Use `window.hide` for hiding Signal on app switch, minimize, and blocking modals.
- Use the patched runtime's internal topmost show/focus/moveTop sequence for `window.show`.
- Keep renderer sync bounded: immediate sync plus one short delayed sync.
