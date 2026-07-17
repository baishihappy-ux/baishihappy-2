# Source recovery / 源码恢复

This repository is the disaster-recovery source for the `maoyi` general release.

本仓库是 `maoyi` 通版的源码灾难恢复仓库。

## Included / 已包含

- Application, Electron main/preload, authorization, prompt-generator, translation, cache, lock-screen, multi-profile, and packaging source.
- WhatsApp, Telegram, and Signal integration source and automated contract tests.
- The exact Signal Desktop 8.18.0 upstream source archive.
- The complete ordered `maoyi` Signal patch series, manifests, checksums, and replay/build tooling.
- 应用、Electron 主进程与预加载、授权、提示词生成器、翻译、缓存、锁屏、多开和打包源码。
- WhatsApp、Telegram 和 Signal 集成源码及自动化契约测试。
- 固定的 Signal Desktop 8.18.0 官方源码归档，以及完整补丁序列、清单、校验值和重放构建工具。

## Intentionally excluded / 有意排除

API keys, license private keys, suite ledgers, customer authorization files, login profiles, translation caches, logs, dependency caches, generated installers, and customer delivery archives are not source and must never be committed.

API 密钥、授权私钥、套装台账、客户授权文件、登录状态、翻译缓存、日志、依赖缓存、生成的安装包和客户交付压缩包不属于源码，禁止提交到 Git 历史。

The GitHub repository is public. Generated customer delivery archives must not be uploaded to either Git history or GitHub Releases.

本 GitHub 仓库保持公开。生成的客户交付压缩包不得上传到 Git 历史或 GitHub Releases。

### Local suite 006 record / 006 本地套装记录

Suite 006 remains local-only and is intentionally excluded from this public repository.

006 套装仅在本机保存，并明确排除在本公开仓库之外。

```text
Path: D:\DF fanyiqi\taozhuang\taozhuang006_7_14_20.01.rar
SHA-256: B212A0143261596356CB45F5C425439CAC9E831AE413ACFA36A10F66850F3CB1
Size: 397903258 bytes
```

The checksum identifies the verified local archive. It does not mean the archive is recoverable from this public repository; maintain a separate protected backup.

该校验值用于识别已核验的本地压缩包，并不表示可以从本公开仓库恢复该文件；必须另行保留受保护的备份。

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

仅品牌、企业专属交付记录、真实密钥、客户运行数据和生成产物被排除或通用化。
