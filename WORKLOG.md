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

Recreate the external reference UI/style from `<external-reference-root>` inside `<project-root>`.

## Current Truth

The current UI is not yet a strict 1:1 recreation. It is an approximation based on extracted assets, bundled CSS fragments, class names, and text strings from the original app package.

A true 1:1 pass still needs direct visual reference:

- Screenshots from the original external reference client, or
- Permission to open the original client only for visual inspection.

Do not claim the UI is complete until it has been compared against real screenshots/window views.

## Hard Constraints

- Do not touch authorization or license logic.
- Do not modify any `.exe` file.
- Treat `<external-reference-root>` as read-only reference material.
- Current work is UI/frontend recreation only. Do not bypass, integrate with, or simulate authorization checks.

## Completed

- Added `COMPETITOR_RUNTIME.md` with confirmed runtime facts:
  - WhatsApp and Telegram are hosted by `external-reference.exe`.
  - No competitor-owned `WhatsApp.exe` or `Telegram.exe` executable was found.
  - Signal is the separate embedded runtime under `external-reference-runtime\signal\Signal.exe`.
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
  - Skin B is named `黑金` and uses root `黑金.png`, copied to `src/assets/black-gold.png`.
  - Replaced the visible post-login `刷新服务器` action with `更换主题`.
  - Theme menu offers `骚粉` and `黑金`, switching page-level classes across login, application center, workspace, panels, buttons, inputs, sidebars, dialogs/menus, and status areas.
- Added `SIGNAL_RESEARCH.md` with a standalone record of the competitor Signal multi-instance implementation:
  - Embedded Signal Desktop runtime.
  - Per-instance `--user-data-dir`.
  - Signal subprocess launch arguments.
  - WebSocket control channel (`appId`, `wsPort`, `windowMode=embed`).
  - Suggested staged implementation plan for this project.
- Read `external reference\external-reference-pro_1.5.36_x64\resources\app.asar` in read-only mode to inspect frontend assets and text clues.
- Extracted assets into `chat-translator/src/assets/external-reference/`:
  - `login-bg.png`
  - `logo.png`
  - `name.png`
  - `favicon.ico`
- Rewrote `src/App.vue`:
  - external reference style login screen using the original class structure clues (`bg-setting`, `login_logo`, `login-box`).
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

Vite dev server was attempted. Its log showed ready, but this restricted environment could not connect to the local port. On the user's machine, run from `<project-root>`:

```powershell
npm.cmd run dev
```

## Files Changed

- `index.html`
- `src/App.vue`
- `src/styles.css`
- `vite.config.ts`
- `src/assets/external-reference/`
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
- 个人技能位于 `<CODEX_HOME>\skills\design-before-implementation`。
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

## 003 老用户升级规则

- 升级包必须复用套装 `183105912` 的原始 `suiteId + keyId + 完整密钥对`，不得只复用数字 ID 后重新生成密钥，否则旧 `license.dat` 会失效。
- 升级仅覆盖程序文件，保留数据位置指针、授权、设备身份、多开配置及 WhatsApp/Telegram/Signal 登录态。
- 首次进入加密缓存版本时只清除旧明文 `TranslationCache` 和三个平台的 `df.translation.renderCache.*`，不迁移旧译文；清理成功后写一次性标记，后续只创建机器绑定加密缓存。
- 新客户仍消耗新的 9 位套装 ID并生成独立密钥对。

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
