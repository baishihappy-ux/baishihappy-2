# 内置 Signal 外来克隆保护

## 目标

本功能阻止项目内改造过的 Signal 被单独打开，或连同登录数据复制到其他电脑后继续使用。

- 原电脑直接打开内置 Signal：提示“缺少启动器，请从maoyi启动”，立即退出，不清理原电脑数据。
- 其他电脑打开复制的内置 Signal：提示“缺少启动器，正在初始化”，清理复制环境中的应用数据后退出。
- 只有已通过 `license.dat` 和本机码校验的maoyi可以启动内置 Signal。
- Signal 在启动守卫通过前不得加载原主程序、账号数据库或聊天窗口。

## 设备与数据绑定

maoyi首次在合法本机准备运行环境时创建：

- `device-identity.dat`：设备 Ed25519 私钥、设备随机密钥和一次性用户名绑定，私密字段由 Electron `safeStorage`（Windows DPAPI）保护。
- `runtime-binding.dat`：位于 `maoyi Data` 根目录，包含签名后的公开绑定载荷，以及由maoyi DPAPI 保护的同内容载荷。
- `resources/df-runtime-binding.dat`：内置 Signal 运行时绑定伴随文件；能够写入安装目录时由根绑定镜像生成。
- `SignalInstances/Signal-<profileId>/df-instance-binding.dat`：按多开实例签名的绑定文件。

运行时绑定包含：

- `productId`
- `suiteId`
- `keyId`
- `installationId`
- `dataRootId`
- `machineCodeHash`
- `hardwareHash`
- 设备公钥
- 创建时间

设备私钥不会写入 Signal、命令行、日志、页面或运行时绑定文件。Signal 使用公钥验证绑定和启动凭证，并重新读取 Windows `MachineGuid` 计算硬件摘要。硬件摘要不一致即判定为外来副本。

## 状态机

1. `FRESH`：没有绑定且没有可信历史数据。Signal 单独启动只执行空初始化并退出；合法maoyi可以建立绑定。若绑定缺失但存在历史数据，Signal 只拦截并保留数据，由maoyi主程序使用 DPAPI 设备身份完成最终判断。
2. `LOCAL_AUTHORIZED`：硬件摘要、签名、套装、实例及一次性启动凭证全部正确，允许加载 Signal 原主程序。
3. `LOCAL_DIRECT_BLOCKED`：本机绑定正确，但没有合法启动凭证。退出且不清理数据。
4. `FOREIGN_CLONE`：签名无效、DPAPI 无法解密、硬件摘要不匹配、套装/机器绑定不一致，进入全量初始化。
5. `RESETTING`：先退出使用目标目录的进程，再删除复制环境中的完整应用数据根目录。
6. `RESET_COMPLETE`：删除数据位置指针和复制的 Signal 运行时绑定后退出；下次相当于全新安装。
7. `RESET_FAILED`：保持禁止进入；显示初始化未完成，下次启动重新识别并重试。

凭证故障本身不会触发删除。只要本机运行时绑定有效，管道丢失、超时、实例不匹配或签名错误都只会退出 Signal，避免误删原机登录态。

## Signal 启动握手

1. maoyi确认客户端授权仍有效。
2. maoyi为本次 Signal 进程建立随机 Windows 命名管道：`\\.\pipe\maoyi-signal-<parentPid>-<128-bit random>`。
3. maoyi启动安装包内置 Signal，不回退到官方 Signal。
4. Signal 守卫在 `app.asar` 原入口前同步读取命名管道。
5. maoyi生成 `256 bit` 随机 nonce，并以设备 Ed25519 私钥签名启动凭证。
6. 凭证绑定 `suiteId + installationId + dataRootId + profileId + Signal PID + issuedAt + expiresAt + nonce`。
7. 凭证有效期固定为 `10,000 ms`，命名管道只接受一个连接。
8. Signal 使用运行时绑定中的设备公钥验签，通过后才加载原 `bundles/main.js`。

命令行只包含随机管道地址，不包含凭证、私钥或服务密钥。

## 全量初始化范围

目标是复制电脑上的整个应用数据根目录，因而会清除：

- Signal 多开登录态和数据库
- WhatsApp、Telegram 指纹浏览器分区和登录态
- 翻译缓存
- 多开配置、锁屏 PIN、客户端账号、授权文件和设备身份
- 旧企业资产目录、运行状态及本地日志
- 指向该数据根目录的 `maoyi Launcher/storage.json`
- 与该数据根绑定对应的 `df-runtime-binding.dat`

安装程序和程序二进制保留。人工导出到数据根目录之外的 Word 文件不扫描、不删除。删除是逻辑删除，不能声称在 SSD 上实现法证级物理擦除。

## 删除安全边界

- 自动删除只接受名为 `maoyi Data` 或兼容旧名 `maoyi` 的本地绝对目录。
- 拒绝磁盘根目录、UNC 网络目录和符号链接数据根。
- 清理计划有效期为 `5 分钟`，包含一次性 `resetId` 和根目录标记。
- 清理进程最多等待父进程退出 `15 秒`。
- 文件删除采用 `0/250/500/1000/2000/4000/8000 ms` 七次尝试。
- 删除子目录时不跟随符号链接或目录联接点。
- 开发环境使用 `MAOYI_USER_DATA_DIR` 覆盖目录时，默认禁止自动删除；只有隔离测试显式开启才允许。

## 打包规则

- `package:win` 在构建前强制执行 `prepare:signal-runtime`，重新注入 Signal 早期守卫。
- 客户包排除 `app.before-signal-control.asar` 及其 `app.asar.unpacked` 原生模块备份，避免交付未加守卫的 Signal 备份包。
- 客户包排除开发机生成的 `df-runtime-binding.dat` 伴随文件，客户首次合法启动后生成自己的本机绑定。
- 打包客户端不设置开发诊断环境变量，不生成守卫诊断文件。
- 本功能不自动生成安装包；只有用户明确要求“打包”时才执行打包。

## 已验证与未验证

已在工作区隔离数据目录实际验证：

- 合法maoyi启动 Signal，守卫返回 `credential-accepted`，Signal 创建数据库并记录主窗口 `ready-to-show` 和显示事件。
- 原机直接启动内置 Signal，守卫返回 `local-direct-blocked`，进程退出且原数据根、绑定和数据库仍存在。
- Signal 读取伪造外机数据根后，整份临时数据根被删除，原机隔离数据未被删除。
- maoyi主程序读取伪造外机数据后，整份临时数据根被删除并退出。
- 单元测试覆盖绑定签名、实例隔离、PID 绑定、`256 bit` nonce、`10 秒`过期、篡改拒绝、命名管道和安全整根删除。
- Signal 补丁已从干净备份重建；重复执行结果为 `changes: []` 且 `app.asar` 哈希不再变化。安全控制测试已验证原生模块、握手、窗口控制及自动关闭。

尚未验证：

- 在第二台实体 Windows 电脑或虚拟机上复制完整内置 Signal 和实例数据后的真实硬件不匹配流程。
- 新生成安装包中的首次授权、绑定、合法启动、直接双击和外机复制五条完整验收路径。
- 整个 Windows 用户配置和 DPAPI 主密钥一起克隆的场景；该威胁边界按用户决定暂不处理。
