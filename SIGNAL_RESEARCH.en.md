# Signal Multi-Instance Runtime Research

## Conclusion

The competitor's Signal implementation is not a WebView and is not Signal Web.

It embeds a Signal Desktop runtime and launches a separate `Signal.exe` with a separate `userData` directory for each Signal instance.

## Observed Directory Structure

Reference directory:

```text
D:\DF fanyiqi\look world\look-world-pro-embed\
```

Key structure:

```text
look-world-pro-embed/
  signal/
    Signal.exe
    resources/app.asar
    resources/app.asar.unpacked/
  Signal-Zh1T4pyBHEc6NK3wDkpR_/
  Signal-ux5d6dbL17c1vQCUsUDSG/
```

Meaning:

- `signal/` is the embedded Signal Desktop runtime.
- Each `Signal-*` directory is a separate Signal instance data directory.
- Each instance directory contains complete Signal / Chromium data such as `sql/db.sqlite`, `config.json`, `Local Storage`, `IndexedDB`, `Network`, `GPUCache`, `logs`, `Preferences`, and `WebStorage`.

## Observed Launch Arguments

Typical competitor launch:

```text
Signal.exe
  --proxy=
  --user-data-dir=D:\DF fanyiqi\look world\look-world-pro-embed\Signal-Zh1T4pyBHEc6NK3wDkpR_
  --appId=Signal-Zh1T4pyBHEc6NK3wDkpR_
  --wsPort=23510
  --title=Signal01
  --windowMode=embed
```

The core isolation argument is:

```text
--user-data-dir=<instance-specific directory>
```

## Competitor Signal Desktop Modifications

The competitor injects control logic into `signal/resources/app.asar`.

The injected runtime parses:

- `appId`
- `wsPort`
- `windowMode`

It connects back to the main app:

```text
ws://localhost:${wsPort}?appId=${appId}
```

Supported control messages include:

- `window.show`
- `window.hide`
- `window.bounds-changed`
- `shutdown`
- `heartbeat`
- `notification`
- `script.execute`

This means the competitor is not only starting multiple `Signal.exe` processes. It modifies Signal Desktop so the child process can communicate with the main process through WebSocket.

## Meaning For This Project

WhatsApp / Telegram can use official web apps:

```text
https://web.whatsapp.com/
https://web.telegram.org/a/
https://web.telegram.org/k/
```

They should use Electron partitions for multi-instance isolation.

Signal must use a separate implementation track:

- Embed or locate a Signal Desktop runtime.
- Use a separate `userDataDir` per Signal profile.
- Launch an independent Signal child process.
- Communicate with the main process through WebSocket or IPC.
- Manage lifecycle: launch, hide, show, shutdown, restart, heartbeat.
- Sync window size and position.
- Add translation, asset sending, and archive integration later.

## Staged Plan

### Phase 1: Basic Multi-Instance

Goal:

```text
Signal multi-instance = independent Signal.exe + independent userDataDir
```

Capabilities:

- Each Signal window logs in independently.
- Multiple accounts do not contaminate each other.
- No workspace embedding yet.
- No deep message read/send automation yet.

### Phase 2: Window Management

Goal:

```text
Main app manages Signal child process windows.
```

Capabilities:

- Maintain a Signal instance list.
- Launch, close, and restart Signal instances.
- Track title, data directory, and status.
- Place child windows in a controlled area or open them independently.

### Phase 3: Advanced Embedding And Control

Goal:

```text
Signal child window overlay + IPC/WebSocket control.
```

Capabilities:

- Child process connects to the main process control channel.
- Main process controls show, hide, bounds, and shutdown.
- Heartbeat detection.
- Notification bridging.
- Prepare the channel for translation and asset features.

## Cautions

- Do not treat Signal as a normal web client.
- Do not build a fake custom Signal login form.
- Do not modify or bypass authorization logic.
- If embedding Signal Desktop, review license, update, security, and data-isolation risks.
- Any modification of Signal Desktop packages must be evaluated for legality and maintainability.
