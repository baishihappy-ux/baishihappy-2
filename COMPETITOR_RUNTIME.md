# Competitor Runtime Notes

## Confirmed

WhatsApp and Telegram do not start as separate `WhatsApp.exe` or `Telegram.exe` processes in the competitor runtime.

Their host process is:

```text
C:\maoyi-workspace\look world\look-world-pro_1.5.36_x64\look-world-pro.exe
```

Evidence:

- Running process inspection showed multiple `look-world-pro.exe` Electron child processes for renderer, GPU, network, audio, and crash handling.
- No competitor-owned `WhatsApp.exe` or `Telegram.exe` process was present.
- Recursive file search under `C:\maoyi-workspace\look world` found no `*WhatsApp*.exe` or `*Telegram*.exe`.
- `look-world-pro.exe` renderer command lines use the shared user data directory:

```text
%USERPROFILE%\AppData\Roaming\look-world
```

Therefore WhatsApp and Telegram are hosted inside the competitor Electron app.

## Platform Split

WhatsApp:

```text
Host: C:\maoyi-workspace\look world\look-world-pro_1.5.36_x64\look-world-pro.exe
Runtime model: Electron renderer/web container
Dedicated executable: none confirmed
```

Telegram:

```text
Host: C:\maoyi-workspace\look world\look-world-pro_1.5.36_x64\look-world-pro.exe
Runtime model: Electron renderer/web container
Dedicated executable: none confirmed
```

Signal:

```text
Host child process: C:\maoyi-workspace\look world\look-world-pro-embed\signal\Signal.exe
Runtime model: embedded Signal Desktop
Dedicated executable: confirmed
Per-instance data dir: C:\maoyi-workspace\look world\look-world-pro-embed\Signal-*
```

Confirmed Signal launch arguments include:

```text
--user-data-dir=C:\maoyi-workspace\look world\look-world-pro-embed\Signal-*
--appId=Signal-*
--wsPort=23510
--title=Signal01
--windowMode=embed
```

## Implementation Direction For This Project

WhatsApp and Telegram should be implemented as Electron web containers:

- Use official web URLs:
  - `https://web.whatsapp.com/`
  - `https://web.telegram.org/a/`
  - `https://web.telegram.org/k/`
- Use one persistent Electron partition per account.
- Keep cookies, localStorage, IndexedDB, cache, and service workers isolated by partition.
- Do not expose manual fingerprint settings.
- Generate lightweight fingerprint values automatically per profile.

Signal should remain a separate design track:

- Do not treat Signal as a normal web app.
- Use a dedicated research/implementation record in `SIGNAL_RESEARCH.md`.
- Do not modify Signal binaries without a legal and maintenance review.
