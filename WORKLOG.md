# Worklog

## 2026-07-08 存档：翻译缓存、Signal 显示、Telegram 待修

本次存档记录当前工程状态，便于后续继续开发，不代表所有体验已完成真实 UI 验收。

已落代码：

- Signal 多开显示稳定性继续沿用当前参数：bounds 同步防抖 80 ms，恢复/切换 burst 100 ms。
- Signal 的长期 800 ms 稳态同步不作为规划参数；显示同步应由窗口变化、平台切换、恢复窗口等事件触发短 burst。
- 翻译缓存拆成磁盘分块缓存、内存热缓存、指纹浏览器内渲染缓存三层。
- 全局内存热缓存上限：120000 条或 320 MB。
- 当前会话预加载：最近 1000 条。
- 单个指纹浏览器渲染缓存上限：1500 条或 15 MB。
- 历史滚动预渲染按批处理，每批最多 100 个气泡译文，命中缓存后一次性提交显示，避免几条几条断续出现。
- 企业聊天资产归档走独立 `EnterpriseChatAssets`（企业聊天资产路径），不和 `TranslationCache`（翻译缓存路径）混在一起。
- 企业聊天资产前端保持静默，不增加设置、按钮、文案。

当前未完成：

- Telegram 译文挂载仍有问题：译文可能不在气泡内正确显示，或者刷新按钮无响应。
- 已尝试从友商本地包分析 Telegram 处理方式，但友商核心脚本很可能通过远程 `scriptUrl`（脚本地址）加载，本地包内不能直接确认具体挂载算法。
- 下一步不再继续解友商包；等用户提供 Telegram 本地 HTML 后，直接按我们自己的真实 Telegram DOM 修正选择器、挂载节点、宽度锁定和刷新按钮逻辑。

硬性要求：

- 不能把 `npm.cmd run build`（运行项目构建检查命令）当作真实 UI 验证。
- 涉及窗口、Signal 显示、Telegram/WhatsApp/Signal 翻译体验时，只有实际打开主程序并手动走过路径，才能说对应体验已验证。

## Current Goal

Recreate the Look World UI/style from `D:\DF fanyiqi\look world` inside `D:\DF fanyiqi\chat-translator`.

## Current Truth

The current UI is not yet a strict 1:1 recreation. It is an approximation based on extracted assets, bundled CSS fragments, class names, and text strings from the original app package.

A true 1:1 pass still needs direct visual reference:

- Screenshots from the original Look World client, or
- Permission to open the original client only for visual inspection.

Do not claim the UI is complete until it has been compared against real screenshots/window views.

## Hard Constraints

- Do not touch authorization or license logic.
- Do not modify any `.exe` file.
- Treat `D:\DF fanyiqi\look world` as read-only reference material.
- Current work is UI/frontend recreation only. Do not bypass, integrate with, or simulate authorization checks.

## Completed

- Added `COMPETITOR_RUNTIME.md` with confirmed runtime facts:
  - WhatsApp and Telegram are hosted by `look-world-pro.exe`.
  - No competitor-owned `WhatsApp.exe` or `Telegram.exe` executable was found.
  - Signal is the separate embedded runtime under `look-world-pro-embed\signal\Signal.exe`.
- Implemented the first real WhatsApp / Telegram multi-open container:
  - Application tiles now create real `ChatProfile` records through Electron IPC.
  - Each profile gets its own persistent Electron partition (`persist:chat-<id>`).
  - The workspace now loads the official platform URL inside an Electron `<webview>`.
  - Opened account environments appear as workspace tabs and in the left environment list.
  - The active webview supports reload and close-current-environment actions.
- Added platform catalog IPC:
  - Main process exposes `platforms:get`.
  - Renderer reads platform labels and official URLs from Electron.
- Added per-profile session setup in the main process:
  - `session.fromPartition(profile.partition)` is configured for each profile.
  - User-Agent is applied at the Electron session level and webview level.
  - Basic webview fingerprint patching is injected on `dom-ready` for WebGL and Canvas seed behavior.
- Removed the manual "轻度指纹浏览器 / 指纹因子" UI because this project should not expose fingerprint settings.
- Updated the default fingerprint strategy:
  - Language and timezone default to IP-based mode.
  - CPU, device memory, and screen resolution default to automatic matching.
  - Fingerprint ID, WebGL labels, and Canvas seed are generated automatically per profile.
  - Each WhatsApp / Telegram profile keeps its own persistent Electron session partition for isolation.
- Rewrote `src/App.vue` as clean UTF-8 text to remove corrupted Chinese UI strings.
- Restyled the frontend into a soft pink macaron visual direction:
  - Shared pink/cream/lavender/mint CSS variables.
  - Frosted glass panels with subtle pink borders.
  - Refined login box, top header, application cards, session sidebar, settings cards, and account panels.
  - Soft pink highlights, restrained pastel shadows, and tighter 8px-radius components.
- Reworked the layout to follow the root reference images `1.jpg`, `2.jpg`, and `3.jpg`:
  - Login screen: left brand area and right workbench login form.
  - Application Center: fixed left brand navigation, central content panel, top action buttons, and right quick rail.
  - Workspace: top toolbar, app tab row, central chat workspace, right translation assistant, and bottom status bar.
- Copied root `马卡龙发光粉.png` into `src/assets/macaron-glow-pink.png` and used it as the brand mark.
- Adjusted the post-login workspace:
  - Window controls are vertical at the top-right.
  - Removed the white horizontal top bar from the workspace view.
  - Removed the workspace top menus and horizontal minimize/maximize/close controls.
- Added runtime skin switching:
  - Skin A is named `骚粉` and keeps the current pink macaron design with `macaron-glow-pink.png`.
  - Skin B is named `黑金` and uses a generic black-gold palette with the CSS `maoyi` geometry mark.
  - Replaced the visible post-login `刷新服务器` action with `更换主题`.
  - Theme menu offers `骚粉` and `黑金`, switching page-level classes across login, application center, workspace, panels, buttons, inputs, sidebars, dialogs/menus, and status areas.
- Added `SIGNAL_RESEARCH.md` with a standalone record of the competitor Signal multi-instance implementation:
  - Embedded Signal Desktop runtime.
  - Per-instance `--user-data-dir`.
  - Signal subprocess launch arguments.
  - WebSocket control channel (`appId`, `wsPort`, `windowMode=embed`).
  - Suggested staged implementation plan for this project.
- Read `look world\look-world-pro_1.5.36_x64\resources\app.asar` in read-only mode to inspect frontend assets and text clues.
- Extracted assets into `chat-translator/src/assets/look-world/`:
  - `login-bg.png`
  - `logo.png`
  - `name.png`
  - `favicon.ico`
- Rewrote `src/App.vue`:
  - Look World style login screen using the original class structure clues (`bg-setting`, `login_logo`, `login-box`).
  - Main top header using the original `home_header` / `home_header_tab` structure.
  - Application Center grid using the original `app-list` / `app-item` layout.
  - Session preview layout using the original side navigation naming (`webview-side-header`, `webview-nav-list`).
  - Settings page and account center page.
- Rewrote `src/styles.css`:
  - Dark background.
  - Gold theme color.
  - Original-like login logo sizing, top tabs, app grid cards, session side nav, settings panel, and related styles.
- Updated `index.html`:
  - Title is `maoyi | maoyi`.
  - Favicon points to the extracted local asset.
- Updated `vite.config.ts`:
  - Set `base: './'` so Electron `loadFile()` can load built JS/CSS/assets from `dist`.
  - This fixed the blank renderer window caused by absolute `/assets/...` paths.

## Verification

This command passed:

```powershell
npm.cmd run build
```

Vite frontend preview starts successfully, but this restricted execution environment does not keep the background process alive across tool calls. On the user's machine, run:

```powershell
npm.cmd exec vite -- --host 127.0.0.1 --port 5173
```

Vite dev server was attempted. Its log showed ready, but this restricted environment could not connect to the local port. On the user's machine, run from `D:\DF fanyiqi\chat-translator`:

```powershell
npm.cmd run dev
```

## Files Changed

- `index.html`
- `src/App.vue`
- `src/styles.css`
- `vite.config.ts`
- `src/assets/look-world/`
- `WORKLOG.md`

## Suggested Next Steps

- First priority next time: obtain or view a real original-client screenshot, then tune against it.
- Tune in this order:
  - Login page exact layout: logo/name placement, title, form row widths, labels, buttons.
  - Application Center exact layout: header spacing, icons, card count, card dimensions, version footer.
  - Settings and Personal Center pages.
  - Session/window-list layout only after the above matches.
- Before continuing, inspect:

```powershell
git status --short
git diff --stat
```

## 2026-07-07 Progress Archive

- 已解决输入框中文连续输入后翻译成英文并发送的问题。
- 已解决 WhatsApp / Telegram 气泡英文自动翻译为中文的核心问题。
- 已处理 WhatsApp 引用回复气泡：引用英文和正文英文分别识别、分别翻译。
- 已开始按平台拆分 WhatsApp 与 Telegram 的气泡扫描、翻译注入、刷新按钮挂载逻辑。
- Telegram 仍有刷新按钮显示位置细节待继续调试，当前先暂停该问题。

## 2026-07-07 Signal Control Channel + Deferred WhatsApp Case

Confirmed:

- WhatsApp still has at least one deferred leak-translation case: specific visible English bubbles can appear without Chinese translation and without the per-bubble refresh button.
- Telegram bubble translation is currently the clean baseline; the unresolved leak case is recorded against WhatsApp only.
- This WhatsApp case is paused by user decision and should be revisited later with live DOM sampling instead of more blind selector changes.

Signal implemented:

- Added the main-process Signal `WebSocket`（网页通信通道） control service.
- Signal launch arguments now include `--wsPort`（控制端口） and `--windowMode=embed`（嵌入托管模式标记）.
- Patched `.runtime\signal-desktop\resources\app.asar`（Signal 应用包） with `__dfSignalControl`（maoyi Signal 控制层）.
- Signal child runtime now supports `ready`（就绪）, `heartbeat`（心跳）, `window.show`（显示窗口）, `window.hide`（隐藏窗口）, `window.bounds-changed`（同步窗口位置和尺寸）, `shutdown`（关闭）, and `script.execute`（脚本执行）.

Verification:

- `npm.cmd run build`（运行项目构建检查命令） passed.
- `node tools\test-signal-control-channel.cjs`（运行 Signal 控制通道测试脚本） passed and received a `ready`（就绪） message from the patched Signal child process.

## 2026-07-10 工作区恢复点

已落源码：

- 首次启动选择数据位置，并自动创建 `maoyi Data` 文件夹。
- 企业资产本地总入口和联系人独立 HTML 时间线。
- 对方历史首次消息或最新消息为中文时持久排除该联系人；拒绝后续缓存和归档，并删除已有联系人范围数据。
- 我方中文输入不写翻译磁盘缓存和企业资产。
- 开发版只使用项目受控 Signal；打包版只允许内置 Signal；禁止官方 Signal 回退。
- 打包客户端无运行诊断日志的源码逻辑，以及启动和正常退出清理；开发环境继续保留日志。
- 离线授权和发送完整性需求已同步保存为中英文设计文档。

验证范围：

- 当前源码修改后的构建和类型检查通过。
- 隔离运行测试确认英文归档、中文原文排除、联系人持久排除、联系人范围数据删除、企业资产总入口生成和自定义数据根目录写入。
- WhatsApp、Telegram、Signal 三个平台真实 UI 的边界消息联系人分类仍未完整验收。
- 打包版无日志策略和仅内置 Signal 规则尚未在新安装包中重新测试。

硬性规则：

- 用户未明确说“打包”时，不生成新安装包。
- 构建检查不等于真实 UI 验证。
- 正式包保留业务数据，但不保留运行诊断日志。
- Git 和 GitHub 禁止包含服务密钥、登录态、客户数据、企业资产、翻译缓存、Signal 运行数据、截图和生成的安装包。

未完成实施：

- 纯数字收款账号和 USDT 钱包地址的发送完整性事务。
- IPC 发送者校验、固定命令白名单、WebView 域名与跳转限制、ASAR 完整性和 Electron Fuses。
- 离线 `license.dat` 协议、客户端验证登录和独立黑金授权程序。
- 完整归档屏障、附件采集，以及归档完成后安全删除多开数据。

后续版本规划：

- 语音条英文转中文已记录为后续版本功能，当前客户验收版不实现。
- 目标体验：英文语音条先转写成英文文字，再翻译成中文，译文显示在对应语音气泡下方。
- 实施顺序：Telegram 优先，其次 WhatsApp，最后 Signal。
- 缓存原则：转写和译文必须写入翻译缓存，重启、切换多开、翻历史时优先缓存秒显，避免重复消耗接口。
- 企业资产原则：后续可归档语音附件索引、英文转写文本和中文译文，但不把音频二进制直接塞进消息文本记录。

离线授权最新规则：

- 授权程序首次打开先设置授权程序密码，并提示必须牢记。
- 授权程序不生成客户登录密码；客户用户名和 6 位英文数字混合登录密码由主程序本地管理。
- 授权程序输出 `license.dat` 和授权码；授权码就是 `license.dat` 内容的文本形态，界面支持点击复制。
- 客户端输入授权码后自动在当前程序数据目录生成 `license.dat`。
- 每套压缩包拥有独立 `suiteId` 和签名密钥，A 套授权程序生成的授权文件不能给 B 套客户端使用。
- 开发者环境维护 10000 条不重复 9 位套装 ID；每次整套打包一开始就消耗 1 个 ID，无论成功或失败都不回收。
- 独立密钥必须使用本次消耗的唯一套装 ID 参与生成，并永久绑定 `suiteId`、`keyId`、公钥指纹、加密私钥指纹和输出目录。

Codex 协作技能：

- 已创建个人技能 `design-before-implementation`，用于约束关键改动先明确设计、参数、逻辑和验收，再落代码。
- 个人技能位于 `C:\Users\admin\.codex\skills\design-before-implementation`。
- 项目内同步副本位于 `chat-translator/codex-skills/design-before-implementation`，用于后续 GitHub 上传时一并带走。
- 后续修改个人技能时，必须同步更新项目内副本。

离线授权程序第一步代码：

- 新增授权核心：授权码格式 `DFLIC1`，支持授权码生成、解析、签名校验、套装 ID/用户名/本机码校验。
- 新增授权程序基础 UI：首次设置授权程序密码、密码登录、输错锁定阶梯、生成授权码、复制授权码、保存 `license.dat`。
- 新增套装 ID 工具：开发者环境生成 10000 条不重复 9 位套装 ID；每次生成套装消耗 1 条 ID，不回收；生成当前套装密钥配置到 `.package-secrets`。
- 本次开发测试已消耗 2 条本地套装 ID，均在 `.package-secrets` 忽略目录内。
- 已完成构建检查、授权码核心自测和 ID 池完整性检查。
- 未完成：主程序授权输入与 `license.dat` 写入、客户端启动验签、客户登录用户名/密码规则、授权程序真实 UI 手动验收、整套打包。

## 2026-07-11 内置 Signal 外来克隆保护

- 新增设备签名运行时绑定、Signal 实例绑定、`256 bit` 一次性凭证和 Windows 命名管道握手。
- Signal `app.asar` 主入口已改为早期守卫；凭证通过前不加载原主程序和账号数据库。
- 新增原机直接启动拦截、外来副本识别、完整数据根初始化及失败重试逻辑。
- 打包前强制重新注入 Signal 守卫，并排除开发机绑定侧栏及未加守卫的 Signal 备份包。
- 已实际验证合法启动、原机直接启动拦截、Signal 外来临时副本整根删除、主程序外来临时数据整根删除。
- 尚未在第二台实体 Windows 电脑或新安装包中验证真实硬件不匹配流程。
- 完整设计、参数和验收边界见 `SIGNAL_CLONE_PROTECTION.md`。

## 003 弃用与 006 新套装规则

- 用户已确认 `003` 套装不再作为旧版本升级对象；不制作 `003` 升级包，不做原地升级、授权重签或数据迁移，已安装用户直接弃用该版本。
- 下一交付套装命名为 `006`；该名称不是 9 位 `suiteId`。
- `006` 必须作为全新独立套装交付。只有用户明确要求正式打包时，才消耗一个新的 9 位套装 ID并生成独立密钥；不得复用 `003` 套装 `183105912` 的 `suiteId`、`keyId` 或密钥材料。
- `006` 不覆盖安装到 `003` 上，`003` 的数据位置指针、授权、设备身份、多开配置及 WhatsApp/Telegram/Signal 登录态不承诺迁移。
- 本次仅记录命名和交付决策；未打包、未消耗套装 ID、未生成 `006` 密钥。

## 2026-07-12 安全加固与发送完整性

- 已完成 Electron、WebView、IPC、授权、翻译缓存、Signal 控制通道和打包边界加固，完整记录见 `SECURITY_HARDENING.md`。
- 已实现纯数字收款账号和 TRC20/ERC20/BEP20/Solana 地址的两次回车发送事务；固定参数和验收边界见 `SEND_INTEGRITY_DESIGN.md`。
- 连续 5 次授权码错误后的锁死、自毁和卸载逻辑保持不变。
- 用户明确决定编号 10（改造 Signal 签名 HashMismatch）和编号 12（安装包/授权程序代码签名）不处理。
- 自动安全测试、真实 Signal 受控启动测试和隔离 Electron 窗口冒烟测试通过；真实三平台支付信息发送尚未人工验收。
- 本轮未打包、未消耗套装 ID、未创建 Git 提交、未推送 GitHub。

## 2026-07-12 Signal 已缓存译文切换优化

- 本轮只优化 Signal 联系人 A/B/A 切换时的已缓存译文贴回；不修改 DeepSeek 实时翻译规则、缓存容量、WhatsApp 或 Telegram。
- 修正缓存贴回调度状态机，连续 DOM 变化不会再丢失后续执行请求。
- Signal 新增或复用气泡节点后，优先在页面微任务中扫描对应新增区域，每批最多处理 200 个候选；`16/48/96/180ms` 全量补贴仍作为兜底。
- Signal 复用旧气泡 DOM、译文节点已经消失但旧哈希标记仍存在时，会清除失效标记并立即重新挂载缓存译文。
- 缓存参数保持 1500 条或 15MB；没有修改窗口 `80ms` 同步防抖和 `100ms` 恢复/切换 burst 参数。
- `npm.cmd run build`、`npm.cmd run test:security` 和真实 Electron 内核的合成 Signal A/B/A 回归测试通过。
- 本机当前 `profiles.json` 为空，尚未完成真实登录 Signal 联系人 A/B/A 人工验收；003 客户包也未包含本轮源码。
- 本轮未打包、未消耗套装 ID、未创建 Git 提交、未推送 GitHub。

## 2026-07-12 翻译缓存全链路加密完成

- 权威磁盘缓存继续使用 `TranslationCache/v3`：每条记录独立 `AES-256-GCM` 加密，32 字节密钥由 Windows DPAPI 保护并绑定 `suiteId + dataRootId`。
- 删除主渲染页 `df.translationCache.v1` 的明文读写；删除指纹浏览器 `df.translation.renderCache.v1.*` 的明文持久读写。
- 指纹浏览器现在只保留最多 1500 条或 15 MB 的进程内译文热缓存，重启后从加密磁盘缓存批量恢复。
- 主渲染页旧键启动即删；WhatsApp/Telegram 在 WebView 就绪时清理；Signal 在对应实例下次合法启动时清理，不为迁移批量启动 Signal，不破坏登录态。
- 安全门禁禁止以后重新加入渲染器 `localStorage.setItem` 明文写入。
- 构建、安全套件、真实 Electron DOM 缓存测试和隔离客户端/授权端窗口烟雾测试通过；实际查看了两张烟雾测试截图，窗口均正常渲染。
- 本轮没有打包、没有消耗套装 ID、没有推送 GitHub；源码纳入重构前本地 Git 恢复点，WhatsApp/Telegram 重构尚未开始。

## 2026-07-12 Signal 官方源码归档与源码集成设计

- 已在根目录隔离保存 Signal Desktop `v8.17.0` 和 `v8.18.0` 官方完整源码与 ZIP；`reference-sources/` 已加入根 `.gitignore`，不进入业务 Git。
- 已核对两个版本的 `package.json` 版本均正确，Electron 均为 `42.3.0`，并记录 ZIP SHA-256，电脑遗失后可重新取得并校验同一源码。
- 已建立中英文同步文档 `SIGNAL_SOURCE_INTEGRATION_PLAN.md` 和 `SIGNAL_SOURCE_INTEGRATION_PLAN.en.md`。
- 实施基线锁定为 `v8.17.0`；先完成启动守卫、类型化桥和窗口控制，再分阶段实现 React 译文槽、输入框守卫、精确未读和通知；`v8.18.0` 只在前者真实验收后前移。
- 当前受控 Signal 运行时和客户 profile 未修改；本轮未构建 Signal、未启动 UI 验收、未打包、未消耗套装 ID、未推送 GitHub。

## 2026-07-12 Signal v8.17.0 隔离源码实验环境

- 已创建隔离分支 `experiment/signal-source-v8.17.0`，不在 `master` 上直接进行 Signal 源码实验。
- 新增受版本控制的 `v8.17.0` 基线清单和补丁序列，锁定官方 ZIP SHA-256、补丁集 SHA-256、Signal/Node/pnpm/Electron 版本、隔离目录、磁盘空间门槛和官方构建命令；未来源码改动必须作为校验过的补丁进入 Git。
- 新增 `check/prepare/verify/preflight/build` 五个入口；`prepare` 只从校验通过的 ZIP 原子解压到 `.tmp/signal-source/v8.17.0`，已存在时验证后退出，不覆盖实验改动。
- 已实际生成隔离副本；参考源码与实验副本均为 `4176` 个文件、`91,424,412` 字节，实验目录由 `chat-translator/.gitignore` 排除。
- 构建前置检查确认 Python 3.13.13、Corepack 0.34.6 和约 609 GiB 可用空间满足要求；当前 Node 24.14.1 不符合官方 24.15.0，且未发现 Visual Studio 2022 C++ Build Tools，因此依赖安装和官方 Signal 构建被主动阻断，不能标记为构建通过。
- 当前 `.runtime/signal-desktop`、客户 profile 和 Signal 源码均未修改；本轮未启动 Signal UI、未打包、未消耗套装 ID、未推送 GitHub。

## 2026-07-12 重启前恢复说明：Signal 拖动卡顿

已经完成：

- 源码改造前设计恢复点为提交 `4da0e3e`；Signal 隔离源码实验环境恢复点为提交 `052f6f9`，当前分支为 `experiment/signal-source-v8.17.0`。
- Signal Desktop `v8.17.0` 与 `v8.18.0` 官方源码和 ZIP 已在 `reference-sources/` 隔离保存并由 Git 忽略；两个 ZIP 的 SHA-256 已写入双语设计文档。
- `v8.17.0` 实验流程已经支持官方归档校验、受控补丁序列、原子准备、重复验证、工具链前置检查和官方构建入口。
- 已实际生成 `v8.17.0` 隔离副本；参考源码与实验副本均为 `4176` 个文件、`91,424,412` 字节。
- 主项目构建和安全门禁通过；Signal 构建前置检查能够在环境不满足时主动阻断，不会误进入依赖安装。
- 已用三种状态对照拖动任务管理器：关闭maoyi、打开maoyi但不显示 Signal、显示 Signal。任务管理器在三种状态下都存在独立的轻微卡顿，而其他普通窗口拖动正常，因此任务管理器现象不由maoyi或 Signal 引起，也不能作为系统整体卡顿证据。
- 显示 Signal 时拖动maoyi主窗口仍有更明显卡顿，该问题继续归入 Signal 窗口贴合链路，不与任务管理器自身刷新混为一谈。

尚未完成：

- 官方未修改 Signal `v8.17.0` 尚未在本机完成首次编译。当前 Node 为 `24.14.1`，官方要求 `24.15.0`；本机尚未发现 Visual Studio 2022 Desktop development with C++。
- 尚未对 Signal 官方源码应用任何业务补丁；当前 `.runtime/signal-desktop` 未被实验构建替换。
- Windows 所有者窗口关系、源码级窗口控制器、直接 `setBounds` 和拖动期间停止 `show/focus/moveTop` 尚未实施。
- 尚未完成源码改造后的真实主窗口拖动、层级、最小化恢复、SG01/SG02 切换、CPU 和内存验收。

重启后执行顺序：

1. 不打开maoyi，拖动普通窗口和任务管理器；把任务管理器实时更新速度设为“暂停”后再拖动一次，用于确认其自身刷新影响。
2. 打开maoyi但不显示 Signal，拖动主程序；再显示 Signal 后重复拖动，对比主窗口跟手程度和 CPU 瞬时占用。
3. 若重启后显示 Signal 时仍明显卡顿，继续源码方案，不回到持续轮询或增加暴力刷新。
4. 补齐隔离构建工具链：精确 Node `24.15.0`、Corepack 提供的 pnpm `11.5.2`、Visual Studio 2022 C++ Build Tools；保留 Python 3.13.13。
5. 首次编译完全未修改的官方 Signal `v8.17.0`，确认干净基线可构建；没有真实构建成功不得写“编译通过”。
6. 分阶段应用源码补丁：先启动守卫与类型化桥，再窗口控制器和 Windows 所有者窗口实验；不同时修改翻译、通知和输入框。
7. 窗口阶段保持 bounds 防抖 `80ms`、恢复/切换 burst `100ms`，移除持续 `800ms` 稳态同步；实际拖动后再用证据决定是否只把拖动路径调整为最高每 `33ms` 一次。
8. 实际验收通过后才评估替换 `.runtime/signal-desktop`；用户未明确说“打包”时不生成安装包，也不消耗套装 ID。

## 2026-07-12 Signal v8.17.0 源码改造兼容合同

- 用户再次确认：`003` 不再作为升级交付对象，但 `003` 已实现的合理 Signal 功能是 `006` 源码改造的强制行为基线，不得因重构丢失。
- 改造版 Signal 只能由maoyi合法启动；原机直接启动只拦截退出且保留数据，整套 Signal 文件和数据复制到非本机后直接启动必须在账号数据库加载前执行既定完整数据根初始化。
- 现有多开隔离、启动守卫、控制通道、窗口控制、翻译、缓存、未读/通知和工作区行为全部纳入零回退范围；源码改造目标是提高性能、安全性并降低 CPU、内存和窗口同步开销。
- 新增机器可读兼容清单 `signal-source/compatibility/v8.17.0.json` 和静态回归 `test:signal-source-compatibility`，并纳入完整安全测试。
- 当前仍未应用 Signal 业务源码补丁，未替换 `.runtime/signal-desktop`，未读取客户 profile，未打包、未消耗 `006` 套装 ID、未推送 GitHub。

## 2026-07-13 Signal v8.17.0 阶段一基线完成

本节以 2026-07-13 的实际构建和窗口报告为准，更新但不删除 2026-07-12 的历史恢复记录。

已确认完成：

- 官方 v8.17.0 ZIP SHA-256 为 `8AC74903BE12CB6F4806CD3B218B1422CC9317560EA9E355DCB3EFAAF1CC9D96`。三张源码补丁 SHA-256 依次为 `DE7BAEA1511C856AA4681F9F1689701D414FC67371C716656902640685C9136A`、`E4268FA2FAE0FBAEEA6ABF463C5A91CACD0F917E43C82211DA30DF76DB83B632`、`78CDC75C460C6CC398585FCECF51FD74556F01E32CBC37E3D4D22C337E0685CD`；v8.17.0 补丁集 SHA-256 为 `6C6CE9E865BFD5904937FE77A76428021EFFDDA350CDE32D80EEE8FC65E83052`。
- 已用固定 Node `24.15.0`、pnpm `11.5.2`、Visual Studio 2022 C++ Build Tools 和 Windows SDK 完成三张补丁串行重放及无签名 Windows 目录构建。构建后的官方 `package.json` 已逐字节恢复。
- `Signal.exe` 为 227,025,408 字节，SHA-256 为 `5D74F92F8130849582F095C8A29E3DAB28CCFBF305BD85ACA82617F87B47E8A9`，Authenticode 状态为 `NotSigned`；这是隔离开发产物，不是安装包。`app.asar` 为 31,466,370 字节、1114 个条目，SHA-256 为 `A412604288AFE55380589B12860726C6BAFC646DA972A7FE9F353500ACA683E0`。`windows-ucv.node` 为 224,768 字节，SHA-256 为 `00F1AD57295675ADC97103DF30C33E796CB0B81ADFF46A8C70632F00C762EFAC`。
- 构建产物检查确认启动守卫、认证控制通道、`security.visibility`、`window.owner`、锁显示门禁、Windows 所有者窗口原生扩展和禁用官方更新均已进入产物。兼容合同、锁屏静态合同、产物检查、6 个启动守卫/控制协议单元测试以及主项目完整安全回归均已通过。
- 真实窗口报告位于 `.tmp/signal-source-ui/2026-07-13T15-37-35-571Z-2476117e/artifacts/report.json`，运行 57.216 秒并通过 14/14 项断言。它实际确认：隔离数据启动、一次性启动凭证接受、指定源码版 `Signal.exe` 运行、控制通道认证、Signal 主窗口的 `GW_OWNER` 指向翻译器主窗口、Signal 真实显示、随翻译器最小化隐藏、恢复后显示、主进程锁门禁隐藏全部 Signal 窗口，以及翻译器退出后目标 Signal 子进程退出。
- 该次 Win32 实测中，Signal PID 为 `2336`，Signal HWND 为 `722524`，翻译器/owner HWND 为 `13173990`。可见态截图 `signal-visible.png` 的 SHA-256 为 `F4ED4878D969827FE0A24AC4A685943AA42447CFC09AD8D1925044822F667D15`；锁门禁态截图 `signal-gate-locked.png` 的 SHA-256 为 `48CA7C167A9D82C403296EB41952AF540462D9C9BD0E910CB7B9C402B8945128`。
- UI 测试只写入 `.tmp/signal-source-ui`，使用 `000000000` 测试哨兵；没有读取客户 profile，没有替换正式 `.runtime/signal-desktop`，没有修改原始干净 release，没有打包或安装，也没有消耗 `006` 或任何 9 位套装 ID。

本阶段遇到且已解决的问题：

- 本机系统 Node 版本和 C++ 工具链最初不满足官方要求；已改用隔离的固定 Node `24.15.0` 并补齐官方构建工具链。
- 首次真实 UI 链路曾因准备目录名称与 marker 版本格式不一致而在启动前失败；已按实际目录 `v8.17.0` 校验。随后测试数据目录使用了不被守卫接受的 `client-data` 名称，触发“缺少启动器”保护；隔离目录改为合法的 `maoyi Data` 后出现 `credential-accepted` 并通过 14/14 项断言。该弹窗来自启动凭证守卫，不是“开发版天然报错”；直接双击改造版 Signal 时弹出并退出属于预期行为。
- 翻译器结束 Signal 时曾错误使用 `child.killed` 判断存活状态；现已改为按退出码和认证 PID 等待，宽限期后仍存活才强制结束，不能确认退出时保持工作区锁定并报错。
- 主题 IPC 曾调用 Electron 不接受的 `setTitleBarOverlay(false)`；现已移除运行时非法调用，保留创建窗口时的 `titleBarOverlay: false`，并加入静态防回归合同。构建和合同测试通过，真实点击两套主题仍待 UI 验收。
- 用户关闭普通开发主程序后，完整 Windows 进程查询确认没有maoyi、Electron 或 Signal 残留进程；此前观察到的进程属于用户手动打开的普通开发会话，不是隔离验收脚本残留。

仍未完成或未确认：

- `script.execute` 仍是未锁定状态下可用的过渡命令；锁定时会拒绝，但最终纯类型命令白名单尚未完成。
- Signal 全源码类型检查仍有一个官方基线错误：`ts/windows/main/attachments.preload.ts` 无法找到 `fs-xattr`。当前只可写“构建和定向测试通过”，不能写“全量类型检查通过”。
- 当前成功报告正式跟踪一个测试 profile/PID；完整双开、SG01/SG02、联系人 A/B/A、登录账号、翻译气泡、中文输入守卫、加密缓存恢复、未读和通知尚未真实验收。
- 锁测试直接调用主进程锁显示门禁；没有验证左侧锁屏按钮、6 位数字加 2 位字母密码、设置/重置时断网、解锁和 15 分钟真实等待。
- 上次锁定状态没有持久化到重启门禁；翻译器渲染器就绪后仍会释放启动期可见性锁，杀进程后重启可绕过“继续要求密码”。
- 15 分钟空闲计时只监听翻译器渲染页活动，外部 Signal 窗口内的操作不会重置计时。
- 控制桥尚无心跳确认超时；新建次级 Signal 窗口的 owner 失败未形成永久逐窗阻断；翻译器也尚未把 `window.owner-attached` 和 `transport.error` 纳入显式健康状态。
- 锁确认只统计 Electron `BrowserWindow`，尚未覆盖任意原生对话框/HWND；远程屏幕捕获保护和防截屏是独立能力，本阶段未实现。
- 主窗口拖动、缩放、主题、无关前台应用层级和 CPU/内存完整矩阵尚未完成。
- 当前工作区变更尚未创建 Git 提交，也未推送 GitHub。

用户确认的前移门槛是“v8.17.0 干净编译 + 首轮窗口控制”。该门槛现已达成，因此开始把同一阶段一补丁集前移到 v8.18.0；v8.17.0 继续保留为可校验回滚基线，以上未完成项不会因前移而被视为完成。

## 2026-07-13 Signal v8.18.0 阶段一前移完成

- 新增独立的 `v8.18.0` 基线、兼容合同和补丁序列。官方 ZIP SHA-256 为 `A1FE955608134DAA81FC4EDDBEA35F8BA57E4CA54B43391B845364965D6C1A66`；三张补丁与 v8.17 逐字节相同，v8.18 补丁集 SHA-256 为 `A4727D862E263B263B9CBAEA731ECF34D2553C7C223D762EEF9748E7792C136F`。
- 源码实验、兼容合同、产物检查和真实窗口工具均支持显式 `--version 8.18.0`，省略参数仍默认 v8.17.0。翻译器只信任两个版本各自精确的补丁集哈希和每次启动时提供的精确可执行文件 SHA-256；未知版本、目录错配、路径越界和补丁集替换均被拒绝。
- 首次受限构建在依赖安装前等待约 10 分钟，没有网络连接也没有生成 `node_modules`；六项构建前置检查当时已全部通过，因此不是缺开发工具。联网原样重跑后，1955 个包来自本地校验缓存，只下载 2 个缺失包，共安装 1958 个包并完成原生模块、源码生成、Rolldown 和 Electron Windows 目录构建。
- v8.18 `Signal.exe` 为 227,025,408 字节，SHA-256 为 `CC83454439A7093730661E6BEEDEC8275A167EF22FC1FEC102D165BA17075710`，Authenticode 状态为 `NotSigned`。`app.asar` 为 31,472,929 字节、1114 个条目，SHA-256 为 `1DE70B075E7AEEDAD89F5D8DD379BC0B0AC7C02323A2612846B4B047DE64F79E`；`windows-ucv.node` 为 224,768 字节，SHA-256 为 `E902F13DEB8B5C259E515AC3EBA8EB1D87907505AB3E34CA8B0F5669A57E51B4`。
- 构建后的 v8.18 `package.json` 与官方参考源码逐字节相同，SHA-256 均为 `E06CFE0A8966FA25AEFBA09CA07F837622C633786E1D1A5F36B4216F0AA610C4`。产物检查确认三组 bundle、启动守卫、认证控制、所有者窗口和锁门禁标记均存在；6 个 v8.18 启动守卫/控制协议单测通过。
- v8.18 全源码类型检查实际进入编译器后仍只有官方基线的 `fs-xattr` 缺失错误；没有把这项写成通过。主项目完整安全回归现在同时检查 v8.17 和 v8.18 兼容合同，并已通过。
- v8.18 真实窗口报告位于 `.tmp/signal-source-ui/2026-07-13T16-12-24-518Z-1c771649/artifacts/report.json`，运行 25.653 秒并通过 14/14 项断言。Signal PID 为 `1116`，翻译器 PID 为 `13068`；Signal HWND 为 `13763814`，owner/翻译器 HWND 为 `2950772`。
- 可见态截图 SHA-256 为 `0C2590DCBB1199D7BBE6A053FC22CEB7F8DBF9FC6B325FE115738C28871C80FB`，实际显示 Signal 扫码界面填充工作区；锁门禁态截图 SHA-256 为 `E9F16C827CA9B95C5D47A172AF2B1DB7B1074FBB315DF16FDD56A625CD0D9BC5`，实际画面中 Signal 内容已消失。测试退出后没有 v8.18 GUI、Signal 或 Electron 残留进程，原始构建目录也没有生成真实运行绑定文件。
- 本地源码比对确认：v8.17 已有完整投票创建、单选/多选、投票/撤票、统计、查看投票人和结束投票能力；v8.18 的主要新增点是把创建投票放开到一对一聊天，并补强投票通知来源和阅后即焚计时。不能写成“v8.18 才首次新增投票功能”。
- 本轮没有替换 `.runtime/signal-desktop`，没有读取客户 profile，没有打包或安装，没有消耗套装 ID，没有创建 Git 提交，也没有推送 GitHub。
- v8.18 阶段一前移已经完成，但 v8.17 工作日志中列出的 `script.execute`、重启锁门禁、Signal 窗口活动不重置空闲计时、心跳超时、次级窗口逐窗 owner、原生对话框覆盖、远程捕获保护和完整功能矩阵等缺口仍然存在。下一阶段已开始只读审计 v8.18 的稳定消息事件、批量缓存查询和 React 译文槽，尚未宣称这些能力已落源码。

## 2026-07-13 Signal v8.18.0 阶段二第一小步完成

- 新增第四张源码补丁 `0004-maoyi-source-translation-cache-bridge.patch`。补丁 SHA-256 为 `E1A261466D7D9F6C38896C7236C9E27067871320123F0BE86EE00A09ADF8F7A8`，四补丁聚合 SHA-256 为 `384B2C5DBA7AD39154E19618C36B5D9AE1ACD53279719F8BE561D49288B0605D`。v8.17 三补丁回滚基线保持不变。
- 0004 只包含 24 个预期源码、测试和样式文件（11 个修改、13 个新增），没有带入 `node_modules`、生成 CSS、protobuf 产物、release 或客户数据。它接入严格类型化的 `message.snapshot.request`、`conversation.changed`、`message.visibleBatch`、`translation.cacheResultBatch` 和 `translation.cacheResultApplied` 链路。
- Signal 只允许绑定的主窗口 renderer（渲染器）在认证、未锁定、主窗口可见且允许暴露时发送正文。当前投影采用“至少包含一个 Latin（拉丁）字母且不含 CJK（中日韩）字符”的确定性条件，不是英语语言识别器。正文批次不超过 100 条/768 KiB；锁定、隐藏、断连、重载或关闭会清空 Signal 渲染侧 LRU（最近最少使用缓存）、正文、运行时和请求关联，但不删除机器绑定加密磁盘缓存。主进程请求账本限制 128 条、30 秒并采用一次性状态迁移；非主窗口不能借 IPC（进程间通信）清空可信状态。
- 缓存结果必须精确匹配 profile、会话、消息 UUID、规范化完整原文和兼容哈希。Signal 内存 LRU 限制为 1500 条/15 MiB，React 译文槽使用文本节点渲染，不写 Signal 数据库、不记录正文。当前主程序只响应已有加密缓存命中，不在这条链路调用 DeepSeek。
- 主程序缓存响应继续完成安全收口：空译文、提示词泄漏、与原文相同或不满足回译用途的无效历史译文按未命中处理；单条旧缓存无效或超过协议上限时只丢弃该条，不暴露正文、不破坏整批。
- 每个认证 `appId` 独立限制为最多 8 个真实未完成的异步查询；切会话、隐藏或锁定虽清除请求关联，实际异步任务结束前仍占并发计数，不能借跨会话清理绕过上限。128 条重放账本不会淘汰 responding（正在响应）项；全为 responding 时拒绝新项。查询失败或并发已满时发送合法空 `translation.cacheResultBatch`，不再沿错误事件方向发送 `type:error`，避免可触发断链的 DoS（拒绝服务）；`test:signal-cache-response` 自动合同已覆盖并通过以上边界。
- A/B 切换竞态、同消息 ID 正文编辑、大小写 UUID 重复、批处理 O(n²)、缓存传输失败后无法重试、A/B/A 返回不重发、React 读操作不触碰真实 LRU、译文与元数据重叠等问题已在本轮修复并进入自动测试。
- 中译英问号合同已固定为 `你确定吗？` → `Are you sure?`：中文原文末尾问号不能丢失；结果统一为一个半角 `?`，全角 `？` 会转换，`??` 会合并，不反向改成英译中规则。该合同落在主程序 `electron/shared.ts`、`electron/main.ts` 的 composer（输入框）翻译路径，`tools/test-composer-question-mark.mjs` 已通过；Signal 源码级输入守卫仍未实现。
- 第一次全构建因受限网络拒绝 npm 下载而停止，获准联网后严格按锁文件重跑并成功；1958 个包中 1957 个来自本机缓存。该失败不是源码不全或开发工具缺失。
- Windows 全局 `core.autocrlf=true` 曾使干净重放的 24 个文件全部变成 CRLF。补丁应用工具现固定 `core.autocrlf=false`；第二次从官方 ZIP 独立准备后，24/24 文件与已格式化源码逐字节一致，CRLF 文件数为 0。
- 产物检查最初按 chunk（构建分块）文件名寻找独立 `windowController`，而 0004 使打包器将窗口控制合并进 `messageBridge` 分块。检查器现同时验证实际 bundle（构建包）内容和 Phase 2 标记，避免把合法合并误报为缺功能。
- 首次 Phase2 GUI 重跑因测试自动登录后又手动登录产生竞态，Signal 工作区被晚到的第二次登录重置回应用中心。测试已改为进入应用中心后不重复登录；产品代码未为此改动。随后报告 `.tmp/signal-source-ui/2026-07-13T17-48-15-353Z-94440bbf/artifacts/report.json` 在 20.812 秒内通过 14/14 项断言。
- 后续验收失败的更深层根因是脚本只检查目标元素自身，忽略隐藏祖先，因而把不可见应用中心误判为已进入。脚本现检查完整祖先链与实际布局可见性，只允许一次有界入口单击，并在失败时按阶段记录不含账号、正文、密钥或凭证的诊断状态。
- 最终 LF（换行格式）源码重放、全构建和产物检查通过，三项产物哈希保持不变：`Signal.exe` 为 227,025,408 字节，SHA-256 `01136BB24024D0D1E5BA0B20357D94F0DB73F3E3A1D3461260462F74400D7C80`；`app.asar` 为 31,490,598 字节、1115 个条目，SHA-256 `9C6579AC615F10067382DF86DD6D1558FCE2E9B9FBD2C211F1BFE4065D57AF86`；`windows-ucv.node` 为 224,768 字节，SHA-256 `A4E10BF7A7524416950423AE40075DC2BC469DC3BF0D5CBCB6E873F27F8E21DA`。
- 34 项 Maoyi Signal 定向测试、23 个文件/380 条静态规则、Prettier、Stylelint、两个版本兼容合同、产物检查和根项目完整安全回归均通过。最新真实窗口报告 `.tmp/signal-source-ui/2026-07-13T19-13-57-209Z-55d629ad/artifacts/report.json` 在 33.042 秒内通过 14/14 项断言；可见态截图 SHA-256 为 `525F0B77875E9E4B0EADC39969E51EF1942555F4C768C9C834D6BF3183EC8D18`，锁门禁态截图 SHA-256 为 `531491CED27FA6B8C064C8ECE7037114FAE2C6BED582E71C9F0EBB85338C7100`。
- `test:signal-transitional-status` 自动合同已通过；人工查看最新锁门禁截图确认：陈旧“消息扫描失败”横幅已经消失，没有 Signal 窗口、二维码或聊天内容，只有正常的 Signal 已启动和输入监听已安装状态。该截图视觉证明了陈旧状态文案修复和本次调用的锁门禁，不代表远控自动遮罩已经实现。
- Signal 全源码类型检查仍只有既有 `attachments.preload.ts` 缺少 `fs-xattr` 的基线错误，因此没有记为通过。真实已登录账号的缓存译文气泡、SG01/SG02 与联系人 A/B/A、源码级中文输入守卫、缓存未命中实时翻译、精确未读/通知、过渡 `script.execute` 删除、远控自动遮罩以及完整主题/拖动/CPU（处理器）/内存矩阵仍未完成；阶段一遗留的重启锁门禁、Signal 窗口活动重置空闲计时、心跳确认超时、次级窗口逐窗 owner（所有者关系）、显式 owner/transport（所有者/传输）健康状态、原生对话框覆盖和远程捕获保护也仍未完成。
- 最终交付验收口径固定为同时保留可重复构建的 `v8.17.0` 回滚基线，并以 `v8.18.0` 作为当前交付基线；两者使用各自独立清单、补丁集和证据，不得相互覆盖。
- 本轮未替换 `.runtime/signal-desktop`，未读取客户 profile，未生成安装包，未消耗 `006` 或其他套装 ID，未创建 Git 提交，也未推送 GitHub。

## 2026-07-13 Signal v8.18.0 阶段二第二小步完成

- 新增第五张可复现源码补丁 `0005-maoyi-realtime-message-translation.patch`，SHA-256 为 `8E7DFAB5EAC76B075826BF4382BBEFFE59D370FBE48A3C2FBF45D59E4D7F9ABA`；五补丁聚合 SHA-256 为 `0E268344E842B0939D1B75E3D92BFB206C562112E2C2ED535F6670766B426417`。补丁只包含 9 个预期源码/测试文件，干净回放与开发树逐文件一致。
- Signal 源码通过官方 `MESSAGES_ADDED` 增量路径发出严格的 `message.added` 事件，只接受当前会话中 Reducer 确认新增的单条活动消息；历史、后台会话、重复、附件、投票、纯 CJK 和超限正文均被拒绝。
- 主程序新增缓存优先的有界实时翻译队列：全局并发 24、每 profile 并发 1、待处理上限 128，初次失败后仅在 5 秒和 30 秒重试。任务键绑定 profile、会话、消息 UUID、兼容哈希和完整规范化正文 SHA-256。
- 主程序独立重算正文哈希并执行 4,000 字符、Latin/CJK 和规范化语义校验。有效译文必须先成功写入机器绑定的加密缓存，之后才请求新快照；无效译文不得保存或刷新。
- 锁定、隐藏、切会话、断连和客户端替换会清除排队/重试/刷新任务并中止在途网络请求；每个异步阶段后都会重验门禁，失效任务不得继续联网、写缓存或刷新。动态测试覆盖缓存命中零 API、保存顺序、去重、并发、重试、第 129 条拒绝和异步取消竞态。
- 从官方 ZIP 独立准备的干净源码完成五补丁串行重放和完整 Windows 构建，耗时 85.2 秒。Maoyi 定向测试 39/39 通过，其中新增链路聚焦测试 21/21 通过；Oxlint 0 错误/0 警告，Prettier、兼容合同、产物合同和主项目完整安全测试均通过。全量源码类型检查仍只有既有 `fs-xattr` 基线错误，不记为通过。
- 最终产物：`Signal.exe` SHA-256 `4C2CA50F29E883BA55EDFFF45E8A8CEF8E71EBC8F2E5C24E8BEAB4FBEAF01852`；`app.asar` SHA-256 `F103D60718D0D9CBA276102BB8382B08F6F391D51DF3E53BF0F6960E414F9BA7`；`windows-ucv.node` SHA-256 `582751A922C78A2C50234F666F06B190ABA5073BAD0A32FF6E783B0E4404DF8F`。产物合同独立复算一致。
- 最新真实窗口报告 `.tmp/signal-source-ui/2026-07-13T20-42-15-586Z-355a12fb/artifacts/report.json` 通过 14/14 项断言，覆盖精确源码产物、启动凭证、认证控制通道、Windows owner、最小化/恢复、锁门禁隐藏及进程退出联动。
- 尚未完成或未真人确认：真实已登录账号收到新英文消息后的译文 UI、可见历史缓存未命中回填、手动刷新、源码级输入框守卫、精确未读/通知、旧消息 DOM 路径退役、完整多开/主题/拖动/CPU/内存矩阵，以及此前记录的重启锁门禁、空闲计时、心跳、次级窗口和远程捕获保护。
- 本轮未替换 `.runtime/signal-desktop`，未读取客户 profile，未打包或安装，未消耗 `006` 或其他套装 ID，未创建 Git 提交，也未推送 GitHub。

## 2026-07-13 Signal v8.18.0 气泡翻译稳定里程碑（人工验收通过）

- 新增第七张源码补丁 `0007-maoyi-incoming-auto-translation-stability.patch`，补丁 SHA-256 为 `F260FAC184A6080E4055CF2BEA8205987841430B8DCF4E834DD0081594656B02`；七补丁聚合 SHA-256 为 `BCE9EE003DF01337EDB941CE4B30EEDDE192768558FE185A919662A9928CD389`。
- 修复真实收到消息的 `contact: []` 被误判为嵌入联系人、增量消息因可见快照修订而被静默丢弃、以及可见缓存未命中不触发有界实时翻译的问题。旧消息、当前可见消息和新消息的缓存未命中现在统一进入既有受门禁、限流、可取消的 DeepSeek 队列。
- Signal 定向聚焦测试 22/22 通过；根项目完整 `test:security` 通过，覆盖锁屏、问号保留、浏览器兼容、Signal 缓存响应、实时翻译队列、源码兼容、授权、运行时安全、缓存加密、敏感发送和 Electron Fuses。
- 使用本地完整 Signal v8.18.0 源码、本地 Node/pnpm/Electron 和既有依赖树完成离线增量打包；没有联网下载、没有重新安装 1958 项依赖、没有使用 SUBST 或映射盘。最终打包耗时 17.1 秒。
- 最终产物：`Signal.exe` 227,025,408 字节，SHA-256 `2DFD1777BA378AB0992B442C3E220815875E9A2EE92BB2CAA076BBCB13EC1058`；`app.asar` 31,497,097 字节、1115 个条目，SHA-256 `ADB6A713A68F1CB60C3C517E7E0675C4D2E135FB346457F7FF422B18978F39F7`；owner 原生组件 SHA-256 `193A22D772ED9FBFB61B14D3F2923EDB19861D151DD9BA605CE05FB57B61FEED`。
- 新运行时已换入隔离验收目录，旧运行时备份为 `release.previous-20260713T223822-0007`；登录数据、验收授权和运行时绑定均保留。没有替换正式 `.runtime/signal-desktop`，也没有生成 006 安装套装。
- 用户人工验收 1–4 全部通过：对方旧/新英文气泡自动显示中文；对方气泡 ↻ 手动刷新有效；我方英文气泡自动翻译；我方气泡 ↻ 仍然有效。
- 本里程碑只证明 Signal 气泡翻译链路通过。此前记录的远控自动遮罩/远程捕获保护、重启锁门禁、Signal 活动重置空闲计时、心跳确认超时、次级窗口逐窗 owner、原生对话框覆盖、精确未读/通知和完整多开/主题/拖动/CPU/内存矩阵仍未因此自动完成。

## 2026-07-13 稳定基线后的工作区交互补充存档

- 本节是稳定基线的 UI 补充，不改变存档优先级。主要里程碑仍是此前已记录并提交的 Signal v8.17/v8.18 可复现源码基线、启动与窗口安全、锁屏与发送完整性、加密翻译缓存、有界实时翻译、气泡自动翻译/手动刷新、完整安全回归和真人验收；界面调整只是锦上添花。

- 工作区左侧“锁屏”下方新增比特币图标按钮。程序每次重启默认处于展开状态；状态不写入本地存储。可见文案描述当前聊天窗口状态：顶部栏可见时显示“展开”，顶部栏收起时显示“折叠”。
- 点击后完整收起/恢复顶部 104px 控制栏。折叠时 Logo、中英文品牌名、版本号、内存状态、翻译反馈、刷新窗口和更换主题全部移除且不留空白；多开标签栏和聊天区上移。最小化、最大化、关闭继续使用原有右上角固定悬浮层，不参与折叠。
- 左侧主页、锁屏、展开/折叠三项统一为 88px 等高行；比特币按钮整体下移 5px。按钮状态切换只改变“展开/折叠”文案，不增加选中高亮；两套主题均保留现有悬停反馈。
- 内部比特币符号直接从用户提供的新 `比特币.png` 去除纯白背景得到 `src/assets/bitcoin-glyph-cutout.png`，保持原始橙色轮廓；原始参考图不进入项目 Git。外圈由界面独立绘制并始终静止。
- 在点击文案“展开”进入折叠状态后，内部比特币符号按 `3秒 → 10秒 → 15秒` 的等待序列循环触发；每次围绕竖直轴旋转 3 圈（1080°），总耗时 2.67 秒，随后回正。下一段等待从前一组三圈结束后开始。点击文案“折叠”恢复顶部栏时，立即取消计时器、停止动画并回正。
- 新增 `tools/test-workspace-header-collapse.mjs` 并纳入完整安全回归，锁定零高度折叠、悬浮窗口控制、重启默认值、等距布局、直接抠图资产、文案语义、三圈动画和 3/10/15 秒序列。构建和专项合同通过；未生成安装包、未消耗 006 套装 ID、未推送 GitHub。

## 2026-07-14 套装 006 打包启动与授权程序隔离修复

- 第一个打包坑：错误启用 `LoadBrowserProcessSpecificV8Snapshot`，但成品没有 `browser_v8_context_snapshot.bin`，导致客户程序、授权程序和提示词生成器在执行应用代码前退出。规则：除非明确生成并打包该快照，否则此熔丝必须关闭；成品验证必须实际启动三个解包程序，不能只检查文件存在。
- 第二个打包坑：授权程序错误复用 `maoyi` 主程序数据目录，导致本机旧 `issuer-state.bin` 让新套装首次打开显示输入密码，并存在跨套装误用旧保险库的风险。
- 修复后，打包授权程序按 `AppData/Roaming/MAOYI AUTHORIZER/<suiteId>/` 隔离状态、密码保险库、输错次数和锁定时间；内置 `suiteId`、`keyId` 和公钥 SHA-256 必须与解锁保险库一致。
- 新增 `test:issuer-suite-isolation` 安全合同；打包成品验证会读取授权程序 `app.asar` 内的套装身份并与当前打包 ID 核对，阻止以后再次生成串用数据目录或身份缺失的授权程序。
- 沿用既有套装 ID `169855092` 修复重建 006，没有生成新 ID。正式授权程序首次启动前专属目录不存在；启动后只创建未初始化的 `issuer-state.bin`，没有 `issuer-vault.dat`；用户已人工确认首次打开显示设置密码，授权程序恢复正常。
