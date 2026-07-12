# maoyi / maoyi

面向国际私聊业务的多平台桌面翻译工作区。

## 功能范围

- WhatsApp Web、Telegram Web A/K 和 Signal Desktop 多开。
- 每个多开独立保存登录态、会话分区和稳定的环境参数。
- 中文输入转自然美式英文，英文气泡回译中文。
- 按多开和会话隔离的加密翻译缓存及批量历史渲染。
- 三个平台的未读提示和不触发已读回执的预览能力。
- Signal 内置运行时、独立实例数据和本地窗口控制通道。
- 离线授权、机器绑定、客户端锁屏和敏感地址发送确认。

## 运行

```powershell
npm.cmd ci
npm.cmd run dev
```

## 构建与检查

```powershell
npm.cmd run build
npm.cmd run test:security
npm.cmd run test:signal-render-cache
npm.cmd run test:electron-smoke
```

## 说明

WhatsApp 和 Telegram 运行在 Electron WebView 中，每个多开使用独立的持久化 session partition（会话分区）。

Signal 使用安装包内置并受启动守卫保护的 Signal Desktop。每个实例拥有独立的 `user-data-dir`，主程序通过本地控制通道完成显示、隐藏、位置同步、关闭和心跳。

GitHub 通版必须保持相同功能和工作区行为，只把企业品牌替换为 `maoyi`，并排除真实密钥、客户数据、登录态和运行缓存。
