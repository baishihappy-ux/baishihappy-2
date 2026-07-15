# Signal 多开运行环境调研记录

## 结论

友商的 Signal 不是 WebView，也不是 Signal Web。它单独内置了一份 Signal Desktop 运行环境，并为每个 Signal 多开实例启动一套独立 `Signal.exe` 和独立 `userData` 目录。

## 观察到的目录结构

参考目录：

```text
D:\DF fanyiqi\look world\look-world-pro-embed\
```

关键结构：

```text
look-world-pro-embed/
  signal/
    Signal.exe
    resources/app.asar
    resources/app.asar.unpacked/
  Signal-Zh1T4pyBHEc6NK3wDkpR_/
  Signal-ux5d6dbL17c1vQCUsUDSG/
```

其中：

- `signal/` 是友商内置的一份 Signal Desktop 程序。
- `Signal-Zh1T4pyBHEc6NK3wDkpR_` 和 `Signal-ux5d6dbL17c1vQCUsUDSG` 是两个独立 Signal 实例的数据目录。
- 每个实例目录内有完整的 Signal / Chromium 数据：
  - `sql/db.sqlite`
  - `config.json`
  - `ephemeral.json`
  - `Local Storage`
  - `IndexedDB`
  - `Network`
  - `GPUCache`
  - `logs`
  - `Preferences`
  - `WebStorage`

## 观察到的启动参数

友商启动 Signal 实例的大致命令：

```text
Signal.exe
  --proxy=
  --user-data-dir=D:\DF fanyiqi\look world\look-world-pro-embed\Signal-Zh1T4pyBHEc6NK3wDkpR_
  --appId=Signal-Zh1T4pyBHEc6NK3wDkpR_
  --wsPort=23510
  --title=Signal01
  --windowMode=embed
```

第二个实例类似：

```text
Signal.exe
  --proxy=
  --user-data-dir=D:\DF fanyiqi\look world\look-world-pro-embed\Signal-ux5d6dbL17c1vQCUsUDSG
  --appId=Signal-ux5d6dbL17c1vQCUsUDSG
  --wsPort=23510
  --title=Signal03
  --windowMode=embed
```

隔离核心是：

```text
--user-data-dir=每个 Signal 实例自己的目录
```

## 友商对 Signal Desktop 的改造痕迹

在 `signal/resources/app.asar` 中可以看到友商注入/改造的控制逻辑。它会解析这些参数：

- `appId`
- `wsPort`
- `windowMode`

并连接主程序 WebSocket：

```text
ws://localhost:${wsPort}?appId=${appId}
```

子 Signal 进程支持接收主程序控制消息，包括：

- `window.show`
- `window.hide`
- `window.bounds-changed`
- `shutdown`
- `heartbeat`
- `notification`
- `script.execute`

这说明友商不是简单启动多个 Signal.exe，而是改造了 Signal Desktop，让 Signal 子进程通过 WebSocket 和主程序通信。主程序可以控制 Signal 窗口显示、隐藏、尺寸、关闭、心跳、通知和脚本执行。

## 推测运行流程

1. 主程序启动。
2. 用户新建 Signal 窗口。
3. 主程序生成随机实例 ID，例如：

   ```text
   Signal-ux5d6dbL17c1vQCUsUDSG
   ```

4. 主程序创建对应 userData 目录。
5. 主程序启动内置：

   ```text
   look-world-pro-embed\signal\Signal.exe
   ```

6. 启动时带上：

   ```text
   --user-data-dir=实例目录
   --appId=实例ID
   --title=Signal03
   --windowMode=embed
   --wsPort=23510
   ```

7. Signal 子进程连接主程序 WebSocket。
8. 主程序把 Signal 窗口嵌入或托管到自己的工作台区域。

## 对本项目的实现意义

WhatsApp / Telegram 可以直接使用官方 Web：

```text
https://web.whatsapp.com/
https://web.telegram.org/a/
https://web.telegram.org/k/
```

并用 Electron `partition` 做多开隔离。

Signal 不能按普通 WebView 实现。要接近友商方案，需要单独设计：

- 内置或定位一份 Signal Desktop。
- 每个 Signal 账号使用独立 `userDataDir`。
- 启动独立 Signal 子进程。
- 使用 IPC 或 WebSocket 与主程序通信。
- 控制子进程生命周期：启动、隐藏、显示、关闭、重启、心跳。
- 同步窗口尺寸和位置。
- 后续再考虑嵌入工作台、翻译助手、素材发送和资产保护联动。

## 建议阶段划分

### 阶段 1：简化多开

目标：

```text
Signal 多开 = 启动独立 Signal.exe + 独立 userDataDir
```

能力：

- 每个 Signal 窗口独立登录。
- 多个账号互不影响。
- 暂不嵌入主工作台。
- 暂不做深度消息读取或发送联动。

### 阶段 2：托管窗口

目标：

```text
主程序统一管理 Signal 子进程窗口
```

能力：

- 主程序维护 Signal 实例列表。
- 可启动、关闭、重启 Signal 实例。
- 可记录实例标题、目录、状态。
- 可尝试将子窗口放置到指定区域，或作为独立窗口打开。

### 阶段 3：高级嵌入与通信

目标：

```text
Signal 子窗口嵌入主工作台 + IPC/WebSocket 控制
```

能力：

- 子进程连接主程序控制通道。
- 主程序控制显示、隐藏、尺寸、关闭。
- 心跳检测。
- 通知桥接。
- 为后续翻译/素材功能准备通信通道。

## 注意事项

- 不要把 Signal 当作普通 Web 端。
- 不要把 Signal 登录页做成自定义假登录表单。
- 不要修改或绕过任何授权逻辑。
- 若采用内置 Signal Desktop，需要处理许可证、更新、安全和数据目录隔离问题。
- 友商的高级方案涉及对 Signal Desktop 应用包的改造，本项目实现时需要评估合法性、可维护性和风险。
