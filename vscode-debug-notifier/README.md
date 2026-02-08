# VS Code Debug Webhook Notifier

这是一个简单的 VS Code 插件，用于在调试会话**暂停**（如命中断点）、**结束**时，以及**终端命令执行完成**时，向指定的 Webhook URL 发送 POST 请求。

## 功能

- 监听 Debug **暂停 (Stopped)** 事件（支持断点、异常等）。
- 监听 Debug **结束 (Terminated)** 事件。
- 监听 **终端命令完成 (Terminal Command Finished)** 事件 (需 VS Code 1.93+)。
- 支持配置 Webhook URL。
- 可配置是否忽略单步调试（Step）触发的暂停（防止刷屏）。
- **[New]** 支持通过正则过滤终端命令（例如仅监听 Python 命令）。

## 配置 (Settings)

在 VS Code 设置 (`Ctrl+,`) 中搜索 `debugWebhook`：

- `debugWebhook.url`: 接收通知的 Webhook 地址 (默认: `http://127.0.0.1:62222/hook`)
- `debugWebhook.ignoreStepEvents`: 是否忽略单步调试 (Step) 产生的暂停事件 (默认: `true`)
- `debugWebhook.notifyTerminalCommands`: 是否启用终端命令完成通知 (默认: `true`)
- `debugWebhook.commandFilterRegex`: **终端命令过滤正则**。
  - 如果留空（默认），则通知所有命令。
  - 如果设置了正则表达式，则只有**匹配**该正则的命令才会触发通知。
  - **示例**: 设置为 `^python` 或 `python` 可以只监听 Python 相关的命令。

## 新特性：后台暂停提醒

如果你的调试会话处于 **暂停状态**，且 VS Code **切到了后台**（失去焦点），插件会每隔 **5 分钟** 发送一次提醒通知，防止你忘记正在调试的任务。

## 新特性：终端命令通知

当你在 VS Code 的终端中执行命令并结束后（无论成功还是失败），插件会发送通知。
**注意**：此功能依赖 VS Code 的 Shell Integration（通常默认开启）。

### 仅监听 Python 命令
如果你只想在运行 Python 脚本时收到通知，可以将 `debugWebhook.commandFilterRegex` 设置为：
`^python`
或者更宽松的：
`python`

## 快速配置

你可以通过命令面板快速修改 Webhook 地址：

1. 按 `Ctrl+Shift+P` (macOS: `Cmd+Shift+P`) 打开命令面板。
2. 输入 `Debug Webhook: Set Server URL`。
3. 输入你的 Webhook 地址（例如：`http://192.168.1.50:62222/hook`）并回车。

## 发送的数据格式

插件会发送如下 JSON 格式的 POST 请求：

```json
{
  "title": "Terminal Command Finished: Success",
  "message": "Command: npm install\nExit Code: 0"
}
```

或者：

```json
{
  "title": "Debug Paused",
  "message": "Debug session \"Run Script\" paused. Reason: breakpoint"
}
```

## 安装使用

1. 确保已安装 Node.js。
2. 在本目录运行 `npm install` 安装依赖。
3. 运行 `npm run compile` 编译。
4. 按 `F5` 启动调试插件窗口（Extension Development Host）。
5. 在新窗口中打开你的项目并进行调试，即可收到 Webhook 通知。

## 打包安装 (可选)

如果想在日常使用：
1. `npm install -g vsce`
2. `vsce package`
3. 也就是生成 `.vsix` 文件，然后在 VS Code 中选择 "Install from VSIX..." 进行安装。
