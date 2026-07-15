# DeepSeek API 接入记录

记录日期：2026-07-06

官方文档：https://api-docs.deepseek.com/

## 结论

- API 使用 OpenAI 兼容格式。
- 接口基础地址：`https://api.deepseek.com`
- Chat Completions 接口：`POST /chat/completions`
- 完整地址：`https://api.deepseek.com/chat/completions`
- 认证方式：HTTP Header `Authorization: Bearer <API Key>`
- 请求格式：JSON。
- 响应格式：JSON，主要读取 `choices[0].message.content`。

## 当前模型选择

官方文档列出的新模型：

- `deepseek-v4-flash`：快速、经济，适合默认聊天翻译。
- `deepseek-v4-pro`：更强模型，适合更高质量但成本/延迟更高的场景。
- `deepseek-v4`：自动路由，官方文档说明当前会路由到 `deepseek-v4-flash`。

旧模型：

- `deepseek-chat`
- `deepseek-reasoner`

官方文档说明旧模型将在 2026-07-24 15:59 UTC 废弃，因此本项目默认模型改为 `deepseek-v4-flash`。

## 翻译请求标准

聊天翻译默认关闭 thinking：

```json
{
  "model": "deepseek-v4-flash",
  "messages": [
    {
      "role": "user",
      "content": "Translate the following chat message to English..."
    }
  ],
  "thinking": {
    "type": "disabled"
  },
  "temperature": 0.2
}
```

关闭 thinking 的原因：

- 聊天翻译需要低延迟。
- 翻译不需要展示推理过程。
- DeepSeek 文档说明启用 thinking 时 `temperature` 会被忽略。

## 翻译提示词原则

系统应要求模型：

- 只返回翻译后的消息，不解释。
- 保留 emoji。
- 保留 URL、电话号码、产品名。
- 保留换行。
- 不额外添加引号、前缀或说明。

当前主进程函数：

- `translateWithDeepSeek`：位于 `electron/main.ts`。
- 默认模型：`deepseek-v4-flash`。
- 响应读取：`choices?.[0]?.message?.content?.trim()`。

## API Key 保存规则

- API Key 不写入仓库文件。
- 开发阶段写入本机 `config.json`。
- 配置文件位置：`C:\Users\admin\AppData\Roaming\chat-translator\config.json`
- 字段名：`deepseekApiKey`

## 后续聊天翻译接入

WhatsApp / Telegram：

- 通过 Electron `webview` 注入脚本。
- 中文输入框内容调用 `translateWithDeepSeek`。
- 翻译结果写入原生输入框。
- 监听消息气泡并对英文内容调用翻译。

Signal：

- 不复用微软商店 Signal。
- 使用独立 Signal Desktop 运行环境。
- 每个 Signal 多开使用独立 `SignalInstances/Signal-<id>` 数据目录。
- 聊天翻译需要 Signal 子进程通信通道，例如 IPC 或 WebSocket。
