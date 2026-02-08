# Features

## Webhook Integration / Webhook 集成

EpochToDo provides a local webhook server for seamless integrations with external tools.
EpochToDo 提供了一个本地 Webhook 服务器，用于与外部工具无缝集成。

- **Port / 端口**: `62222`
- **Endpoint / 接口**: `/hook`
- **Method / 方法**: `POST`
- **Content-Type**: `application/json`

### Payload Format / 数据格式

#### 1. General Notification / 通用通知
Used for sending system notifications.
用于发送系统通知。

```json
{
  "title": "Task Completed",
  "message": "Build finished successfully."
}
```

#### 2. Training Status Update / 训练状态更新
Used for updating long-running training tasks.
用于更新长时间运行的训练任务。

```json
{
  "task_id": 123,
  "eta": "2h 30m",
  "metrics": {
    "loss": 0.05,
    "accuracy": 0.98
  }
}
```

---

## VS Code Debug Notifier Extension / VS Code 调试通知插件

A VS Code extension is included in the `vscode-debug-notifier/` directory. It sends notifications to EpochToDo when a debug session pauses or ends.
在 `vscode-debug-notifier/` 目录下包含了一个 VS Code 插件。当调试会话暂停或结束时，它会向 EpochToDo 发送通知。

### Features / 功能
- **Debug Paused**: Notifies when a breakpoint is hit.
- **Debug Ended**: Notifies when the debug session terminates.
- **Background Reminder**: Reminds you every 5 minutes if debugging is paused while VS Code is in the background.

### Configuration / 配置
- `debugWebhook.url`: The webhook URL (Default: `http://127.0.0.1:62222/hook`).
- `debugWebhook.ignoreStepEvents`: Whether to ignore pause events triggered by stepping (Default: `true`).

### Installation / 安装
1. Navigate to the `vscode-debug-notifier/` directory.
   进入 `vscode-debug-notifier/` 目录。
2. Install dependencies: `npm install`
   安装依赖：`npm install`
3. Package the extension: `npx vsce package`
   打包插件：`npx vsce package`
4. Install the generated `.vsix` file in VS Code (`Extensions` -> `...` -> `Install from VSIX...`).
   在 VS Code 中安装生成的 `.vsix` 文件（`扩展` -> `...` -> `从 VSIX 安装...`）。

---

## Development Configuration / 开发配置

### AI Context Indexing / AI 上下文索引
This project uses `.cursorignore` (or `.codeignore`) to manage file indexing for AI assistants (like OpenCode/Cursor).
本项目使用 `.cursorignore`（或 `.codeignore`）来管理 AI 助手（如 OpenCode/Cursor）的文件索引。

- **Behavior**: These files override `.gitignore` for AI context purposes.
- **Goal**: Allows local documentation (e.g., in `mydocs/`) to be indexed and referenced by AI, even if they are ignored by Git to prevent accidental uploads.
- **Config**: `mydocs/` is explicitly removed from the ignore list in `.cursorignore`.
