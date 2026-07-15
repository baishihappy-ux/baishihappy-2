# Source recovery / 源码恢复

This repository is the disaster-recovery source for the `maoyi` general release.

本仓库是 `maoyi` 通版的源码灾难恢复仓库。

## Included / 已包含

- Application, Electron main/preload, authorization, prompt-generator, translation, cache, lock-screen, multi-profile, and packaging source.
- WhatsApp, Telegram, and Signal integration source and automated contract tests.
- The exact Signal Desktop 8.18.0 upstream source archive.
- The complete ordered `maoyi` Signal patch series, manifests, checksums, and replay/build tooling.
- 应用、授权、提示词生成器、翻译缓存、锁屏、多开、打包以及三种聊天平台集成源码和测试。
- 固定的 Signal Desktop 8.18.0 官方源码归档、完整补丁序列、清单、校验值与重放工具。

## Intentionally excluded / 有意排除

API keys, license private keys, suite ledgers, customer authorization files, login profiles, translation caches, logs, dependency caches, generated installers, and customer delivery archives are not source and must never be committed.

API 密钥、授权私钥、套装台账、客户授权文件、登录状态、翻译缓存、日志、依赖缓存、生成的安装包及客户交付压缩包不属于源码，禁止提交到 Git 历史。

## Recovery checks / 恢复检查

```powershell
git clone https://github.com/baishihappy-ux/baishihappy-2.git
cd baishihappy-2
Get-FileHash -Algorithm SHA256 .\reference-sources\Signal-Desktop-v8.18.0.zip
npm.cmd ci
npm.cmd run build
npm.cmd run test:security
npm.cmd run signal-source:check:v8.18
```

The Signal archive hash must be:

```text
A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66
```

Signal dependency caches and the pinned Node/pnpm toolchain are reproducible build inputs, not source. Re-provision them according to `signal-source/baselines/v8.18.0.json` before running the offline Signal build workflow.

Signal 依赖缓存以及固定版本的 Node/pnpm 工具链属于可重新准备的构建输入，不属于源码。执行 Signal 离线构建前，按 `signal-source/baselines/v8.18.0.json` 重新准备即可。

## Source checkpoint / 业务源码基线

This general-release snapshot was derived from business source checkpoint:

```text
c8b93b1a6acf956716048315ef89115063b80fdf
```

Only branding, enterprise-specific delivery records, real secrets, customer/runtime data, and generated artifacts are excluded or generalized.
