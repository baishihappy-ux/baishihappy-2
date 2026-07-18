# Signal 进展记录

## 2026-07-07 最新进展

Confirmed:

- 本机可用 Signal Desktop 路径：`%USERPROFILE%\AppData\Local\Programs\signal-desktop\Signal.exe`。
- 友商内置 Signal 路径：`C:\maoyi-workspace\look world\look-world-pro-embed\signal\Signal.exe`。
- 本项目已新增阶段 1 代码：创建或点击 Signal 多开时，主进程会启动 `Signal.exe`，并传入当前多开的独立 `--user-data-dir=...`。
- 本项目关闭 Signal 多开时，会先停止已记录的 Signal 子进程，再删除对应 `signalDataDir`。
- `npm.cmd run build` 已通过。

Test result:

- 单次启动测试可看到 `Signal.exe` 命令行包含独立 `--user-data-dir=C:\maoyi-workspace\chat-translator\.tmp\signal-launch-test`。
- 连续启动两个不同 `--user-data-dir` 的官方 Signal 测试实例时，只确认到一个 `Signal.exe` 进程。

Conclusion:

- 官方未改造 Signal Desktop 不能确认直接支持真正多开。
- 仅靠 `--user-data-dir` 还不能对齐友商。
- 要对齐友商，需要进入阶段 2：内置或复制一份 Signal Desktop，改造 `app.asar`，让 `appId` 参与实例隔离，并增加 WebSocket 控制通道。

Next implementation target:

1. 解包 Signal `app.asar`。
2. 定位 `requestSingleInstanceLock` 或等价单实例锁逻辑。
3. 改为按 `appId` 区分实例，或者在受控运行模式下禁用全局单实例限制。
4. 增加 `ws://localhost:${wsPort}?appId=${appId}` 控制连接。
5. 支持 `window.show`、`window.hide`、`window.bounds-changed`、`shutdown`、`heartbeat`、`notification`、`script.execute`。
6. 主程序增加 Signal 子进程状态表、心跳、关闭回收、窗口托管。
7. 后续再接 Signal 聊天输入翻译和气泡翻译。

## 2026-07-07 多开突破

Confirmed:

- 官方 Signal `app.asar` 有两层完整性校验：
  - `bundles/main.js` 文件级 SHA256。
  - `Signal.exe` 内嵌的 `resources\app.asar` 包头 SHA256。
- 只改 `app.asar` 的内容会触发文件级错误：`ASAR Integrity Violation: got a hash mismatch`。
- 只更新 `app.asar` 文件级 hash 会触发包级错误：`Integrity check failed for asar archive`。
- 正确补丁流程是：
  1. 等长替换 `f.app.requestSingleInstanceLock()` 为 `process.argv.includes("--df")||01`。
  2. 更新 `app.asar` 内 `bundles/main.js` 的 integrity hash。
  3. 计算新的 `app.asar` header hash。
  4. 等长替换 `.runtime\signal-desktop\Signal.exe` 内嵌的旧 header hash。
- 改造后的 `.runtime\signal-desktop\Signal.exe` 已验证可启动。
- 双实例测试通过：同时存在 2 个 `Signal.exe` 进程，分别使用：
  - `C:\maoyi-workspace\chat-translator\.tmp\signal-multi-a`
  - `C:\maoyi-workspace\chat-translator\.tmp\signal-multi-b`

Current implementation:

- 本项目主进程已优先使用 `.runtime\signal-desktop\Signal.exe`。
- Signal 启动参数已改为：

```text
--df
--user-data-dir=<当前多开的独立数据目录>
--appId=Signal-<profile.id>
--title=<自定义名称>
```

Remaining gaps:

- 还没有 WebSocket 控制通道。
- 还没有窗口嵌入/隐藏/显示/尺寸同步。
- 还没有 `script.execute` 注入能力。
- 还没有 Signal 聊天输入翻译和气泡翻译。

## 2026-07-07 路径参数问题

Confirmed:

- PowerShell `Start-Process` 测试时，如果直接传 `--user-data-dir=C:\maoyi-workspace\...`，Signal 日志会显示 `userData: D:\DF`，路径被空格截断。
- 路径被截断后会读到错误目录，出现 `sqlcipher_page_cipher: hmac check failed`、`sqlite3Codec: error decrypting page 1 data`，界面会弹错误提示。
- 使用不含空格的数据目录测试，Signal 正常启动，没有数据库解密错误。
- 使用本项目主程序同款 Node `spawn` 启动方式测试，即使 `user-data-dir` 含空格，Signal 日志也能显示完整路径。

Conclusion:

- 之前看到的错误弹窗来自测试命令的参数拼接方式，不代表项目主程序 Signal 启动逻辑失败。
- 项目代码里的 `spawn(executable, args)` 方式可以正确传递带空格路径。

## 2026-07-07 界面验证

Confirmed by user:

- 在maoyi界面中新建 Signal 多开，目前能正常打开。
- Signal 登录页显示目前没问题。

Next target:

- 主程序管理 Signal 窗口生命周期：点击顶部多开标签唤起对应 Signal 窗口，关闭多开时关闭对应 Signal 进程。
- 后续再进入窗口托管、隐藏/显示、尺寸同步和 WebSocket 控制。

## 2026-07-07 进程关闭补强

Implemented:

- `stopSignalProfile` 不只关闭记录的主进程 PID。
- 在 Windows 上会按当前 Signal 多开的 `--user-data-dir` 匹配 `Signal.exe` 命令行，并强制关闭同一数据目录下的 GPU / renderer / network 等子进程。

Verification:

- `npm.cmd run build` 已通过。

## 2026-07-07 Signal 控制通道

Confirmed:

- 主程序已新增 Signal `WebSocket`（网页通信通道）控制服务。
- 启动 Signal 多开时，主程序现在会传入：
  - `--appId=Signal-<profile.id>`（Signal 多开身份）
  - `--wsPort=<port>`（主程序控制端口）
  - `--windowMode=embed`（嵌入托管模式标记）
- `.runtime\signal-desktop\resources\app.asar`（Signal 应用包）已注入 `__dfSignalControl`（maoyi Signal 控制层）。
- 注入层支持接收：
  - `window.show`（显示窗口）
  - `window.hide`（隐藏窗口）
  - `window.bounds-changed`（同步窗口位置和尺寸）
  - `shutdown`（关闭 Signal 子进程）
  - `script.execute`（在 Signal 窗口内执行脚本）
- `Signal.exe`（Signal 程序）内嵌的 `app.asar`（Signal 应用包）完整性哈希已同步替换。

Verification:

- `npm.cmd run build`（运行项目构建检查命令）已通过。
- `node tools\test-signal-control-channel.cjs`（运行 Signal 控制通道测试脚本）已通过。
- 测试脚本收到 Signal 子进程发回的 `ready`（就绪）消息，包含 `appId`（多开身份）、窗口标题和窗口尺寸。

Remaining:

- 主界面还没有把 Signal 窗口真正嵌入工作区。
- Signal 聊天输入中文转英文、气泡英文转中文、引用气泡翻译还没有接入。
- Signal 通知身份和点击通知后的路由污染问题仍记录为后续处理项。

## 2026-07-07 Signal 工作区托管第一版

Confirmed:

- 主程序新增 `signal:set-workspace-bounds`（同步 Signal 工作区位置和尺寸）接口。
- 主程序新增 `signal:hide`（隐藏指定 Signal 多开窗口）接口。
- 前端切换到 Signal 多开时，会读取 `.runtime-web-main`（多开工作区显示区域）的矩形，并发送给主进程。
- 主进程把前端矩形换算为屏幕坐标后，通过 `WebSocket`（网页通信通道）发送 `window.bounds-changed`（同步窗口位置和尺寸）和 `window.show`（显示窗口）。
- 切换到其他应用或其他 Signal 多开时，会发送 `window.hide`（隐藏窗口）隐藏非当前 Signal 窗口。
- 窗口尺寸变化时，会通过 `ResizeObserver`（尺寸变化监听器）和 `resize`（窗口尺寸变化事件）重新同步 Signal 窗口位置和尺寸。

Verification:

- `npm.cmd run build`（运行项目构建检查命令）已通过。
- `node tools\test-signal-control-channel.cjs`（运行 Signal 控制通道测试脚本）已通过。

Current limitation:

- 这是“窗口托管/贴合工作区”的第一版，不是 Windows 原生 `SetParent`（把窗口改成主程序子窗口）嵌入。
- 用户视觉上会更接近嵌入效果，但任务切换、层级遮挡、焦点细节还需要实机验证。

## 2026-07-07 Signal 控制通道断开弹窗修复

Confirmed:

- 强制关闭 Signal 子进程时，主进程可能收到 `ECONNRESET`（连接被对端重置）。
- 之前主进程没有监听 Signal 控制通道 socket 的 `error`（网络连接错误事件），Electron 会弹出 `A JavaScript error occurred in the main process`（主进程 JavaScript 错误）。

Implemented:

- `handleSignalControlUpgrade`（处理 Signal 控制通道升级连接）已增加 `socket.on('error')`（网络连接错误处理）。
- 以后 Signal 子进程关闭、崩溃或连接被重置时，主进程会清理连接状态，不再弹该 JavaScript 错误。

Verification:

- `npm.cmd run build`（运行项目构建检查命令）已通过。

## 2026-07-07 Signal 数据库启动错误处理

Confirmed:

- 现有 Signal 多开目录中，`Signal-16081799-8459-4816-a3e0-53d12f9fcfcb`、`Signal-4c2f08b6-6382-4457-a5ff-ec1d9961d4cb`、`Signal-807b1792-f965-42c4-b5d4-597d925487af` 的日志出现 `Database startup error`（数据库启动错误）/ `SQLITE_NOTADB`（SQLite 不是数据库）错误。
- `Signal-22c9dcea-9534-43f4-8fb2-19f196c2d1aa` 没有该错误日志，未处理该目录。

Implemented:

- `launchSignalProfile`（启动 Signal 多开）启动前会检测实例目录日志。
- 如果发现 `Database startup error`（数据库启动错误）、`safeStorage.decryptString`（安全存储解密失败）、`SQLITE_NOTADB`（SQLite 不是数据库）、`hmac check failed`（数据库校验失败）或 `error decrypting page`（数据库页解密失败），会先关闭该实例进程，把旧目录重命名为 `.broken-时间戳`（损坏备份目录），再创建干净同名目录。
- 已手动隔离 3 个确认损坏的目录，备份后缀为 `.broken-20260707-205159`。

Verification:

- `npm.cmd run build`（运行项目构建检查命令）已通过。
- 用重建后的 `Signal-4c2f08b6-6382-4457-a5ff-ec1d9961d4cb` 启动测试 12 秒，日志没有新的 `Database startup error`（数据库启动错误）、`SQLITE_NOTADB`（SQLite 不是数据库）或 `safeStorage.decryptString`（安全存储解密失败）。
