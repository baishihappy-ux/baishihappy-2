# Signal Notes

## 2026-07-08 Competitor Runtime Findings

Confirmed from the running Look World client and extracted runtime:

- Look World launches embedded Signal with `--appId`, `--wsPort`, `--windowMode=embed`, and a per-instance `--user-data-dir`.
- The active test instance used `--wsPort=23510` and connected back to the main Look World process over localhost WebSocket.
- The embedded Signal window was still a top-level `Chrome_WidgetWin_0` window with `Parent=0x0`; no native `SetParent` child-window embedding was observed in the window handle inspection.
- The embedded Signal control code handles `window.show`, `window.hide`, `window.bounds-changed`, `shutdown`, `heartbeat`, and `notification`.
- Its `window.show` handler temporarily calls `setAlwaysOnTop(true)`, then `show()`, `focus()`, and finally `setAlwaysOnTop(false)`.
- Its notification layer sets a custom Windows App User Model ID and constructs notifications through that identity. Exact notification-click-to-instance routing remains a later task.

Implementation notes:

- For display bugs, mirror the temporary always-on-top show sequence before considering heavier native `SetParent` work.
- Later, implement dedicated embedded Signal notification identity and token/profile routing after display behavior is stable.

## 2026-07-08 Signal Display Fix Notes

Problem symptoms confirmed by user during manual testing:

- Signal could display after app startup, but disappeared after switching between Signal multi-open tabs.
- Signal disappeared after minimizing the main app and restoring it from the Windows taskbar.
- Signal did not reliably follow the main app minimize behavior.
- Earlier recovery depended on clicking Signal in the Windows taskbar, but embedded Signal later had `skipTaskbar` enabled, so that manual recovery path disappeared.
- Some attempts caused visible flicker and high CPU spikes during SG01/SG02 switching and main-window restore.

Root causes and rejected approaches:

- Do not use a frequent external PowerShell polling/sync loop for Signal window styling or visibility. It caused CPU spikes and poor UX.
- Do not treat Signal as a real native child window unless there is a deliberate `SetParent` implementation. The competitor did not use native child-window embedding; it used a top-level frameless Signal window aligned over the main app workspace.
- Do not clear pending Signal workspace bounds on main-window minimize/hide. Clearing bounds loses the information needed to restore the correct Signal window after the main app returns.
- Do not send repeated aggressive show/focus/bounds bursts. They reduce disappearance but create flicker and CPU pressure.
- Do not send a separate `window.focus` after every visible bounds sync. The embedded Signal side already raises the window in `window.show`; extra focus calls increased flicker.

Final direction used:

- Follow the competitor-style top-level window overlay model:
  - Signal stays a top-level Electron/Chromium window.
  - Signal is frameless.
  - Signal uses `skipTaskbar`.
  - The main app knows the workspace rectangle and sends it through the Signal WebSocket control channel.
- Inside the patched Signal runtime, `window.show` performs the raise sequence:
  - set bounds first when bounds are provided.
  - temporarily `setAlwaysOnTop(true)`.
  - call `show()`.
  - call `focus()`.
  - call `moveTop()`.
  - then `setAlwaysOnTop(false)`.
- `window.hide` is the correct hide primitive for:
  - switching from Signal to WhatsApp/Telegram.
  - main-window minimize/hide.
  - modal dialogs that must not be covered by Signal.
- Main-window minimize/hide should hide Signal windows but preserve pending workspace bounds.
- Main-window restore/show should request a renderer workspace sync and resync any pending visible Signal windows.
- Renderer sync should be small and bounded:
  - one immediate sync.
  - one short delayed sync, currently 100 ms.
  - no long repeated 800 ms steady-state sync loop.

Current user-confirmed behavior after fixes:

- Switching between Signal multi-open tabs no longer makes all Signal windows disappear.
- Minimizing and restoring the main app no longer leaves the active Signal visually lost.
- Signal flicker was reduced and then stopped after reducing sync bursts and removing redundant focus.
- CPU spikes during Signal switching and restore dropped from previous 100% behavior to much lower momentary usage in the user's Task Manager observations.
- Signal `+` new multi-open works after hiding Signal while blocking modal dialogs are open.

Important verification wording:

- Build checks only prove compilation, not display correctness.
- Do not write "verified" for Signal display behavior unless the actual app is restarted and the UI path is manually tested.
- When only `npm.cmd run build` passes, state: build passed, actual UI behavior not manually tested.
