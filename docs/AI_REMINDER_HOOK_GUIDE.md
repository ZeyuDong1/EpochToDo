# AI 任务提醒 Hook 接入指南

> **给 AI 助手看：** 读这一份文件就能把你的 CLI / agent 接到 EpochToDo，把任务状态作为「软提醒」推到用户的桌面。无需 API Key、无需认证，发一个 HTTP POST 即可。

---

## 这是什么

EpochToDo 是一个 Electron 桌面任务管理器，监听本地 HTTP webhook。AI 编码助手（OpenCode / Claude Code / Cursor / 自定义脚本）可以在**长任务完成、构建/测试出结果、需要人类输入、请求代码审查**等时刻，发一条提醒过来。

提醒是**软的**：不响铃、不抢焦点、不弹模态窗。它只刷新两个位置——
- **主界面（Dashboard）右栏**「AI Reminders」面板（青色）
- **Spotlight（Alt+Space 悬浮窗）** 里「Soft Reminders」下方的「AI Reminders」卡片

---

## 端点

```
POST http://127.0.0.1:62222/hook
Content-Type: application/json
```

- 端口固定 `62222`，绑定本机。**用 `127.0.0.1`**（不要用 `localhost`，某些系统会先解析成 IPv6 `::1` 导致连接拒绝）。
- 无需鉴权。服务随 EpochToDo 启动而启动；EpochToDo 没开时请求会失败（忽略错误即可，不要阻塞你的主流程）。
- **总是非阻塞地发送**：建议设短超时（如 2 秒）并吞掉失败，提醒失败不应影响你的主任务。

---

## 请求体（Payload）

```jsonc
{
  "kind": "ai",                       // 必填，固定为 "ai"（判别符，勿漏）
  "source": "Claude Code",            // 必填，你的名字 / agent 名
  "title": "构建通过",                 // 必填，一句话摘要
  "status": "success",                // 可选，默认 "info"，取值见下表
  "detail": "main #f3a1 · 42 tests",  // 可选，较长说明（一行即可）
  "link": "https://ci.example.com/1", // 可选，可点击的外部链接
  "timestamp": 1718900000             // 可选，epoch 秒；缺省由 EpochToDo 打时间戳
}
```

### 字段规则

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `kind` | ✅ | `"ai"` | 判别符。漏了会被当成旧式通用通知（只弹一次窗），不会进 AI Reminders 区。 |
| `source` | ✅ | string | 发送方名称，显示为主标题（如 `Claude Code`、`Cursor`、`build-bot`）。trim 后不能为空，否则返回 400。 |
| `title` | ✅ | string | 一句话摘要。trim 后不能为空，否则返回 400。 |
| `status` | ❌ | enum | `success` / `failure` / `needs_input` / `review` / `info` / `progress`，默认 `info`。未知值当 `info`。 |
| `detail` | ❌ | string | 补充说明，第二行灰色小字。 |
| `link` | ❌ | string | `http(s)://` 开头的 URL；用户点条目会用系统浏览器打开。非 http(s) 会被忽略。 |
| `timestamp` | ❌ | number | epoch **秒**（不是毫秒）。缺省用服务端当前时间。 |

### status 语义（重要）

`status` 决定提醒**去哪**以及**配色**：

| status | 含义 | 去向 | 配色 |
|--------|------|------|------|
| `success` | 某事完成，需用户查看结果 | **自动转为可操作任务，进入 Soft Reminders（琥珀），可专注/完成** | 绿 |
| `failure` | 失败 | AI Reminders（瞬时） | 玫红 |
| `needs_input` | 需要人类输入 / 卡住等回复 | AI Reminders（瞬时） | 琥珀 |
| `review` | 请求代码审查 | AI Reminders（瞬时） | 紫 |
| `info` | 一般信息（默认） | AI Reminders（瞬时） | 青 |
| `progress` | 进行中进度 | AI Reminders（瞬时） | 青 |

- **瞬时提醒**：只存内存（最近 20 条，新的在前），重启 EpochToDo 后清空，不入库、不入任务列表。
- **`success`**：会落库成一个 ad-hoc 任务（标题 `🤖 {source} · {title}`），用户可在 Soft Reminders 里对它**开始专注**或**完成**；这是唯一会持久化的情况。

> 选择建议：跑完一个长任务/构建/测试 → `success`；只是报个状态/进度 → `info`/`progress`；失败 → `failure`；要用户回来看一眼决定下一步 → `needs_input` 或 `review`。

---

## 响应

- 成功：`200`，体 `{"success":true}`
- 缺 `source`/`title`：`400`，体 `{"error":"ai reminder requires \"source\" and \"title\""}`
- EpochToDo 未运行：连接拒绝（curl exit code 7）——**忽略即可**。

---

## 最小示例

### curl
```bash
curl -s -X POST http://127.0.0.1:62222/hook \
  -H "Content-Type: application/json" \
  --max-time 2 \
  -d '{"kind":"ai","source":"Claude Code","title":"构建通过","status":"success","detail":"main #f3a1","link":"https://ci.example.com/1"}'
```

### PowerShell
```powershell
$body = @{ kind='ai'; source='Claude Code'; title='构建通过'; status='success'; detail='main #f3a1' } | ConvertTo-Json
try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:62222/hook' -ContentType 'application/json' -Body $body -TimeoutSec 2 } catch {}
```

### Node.js
```js
function notifyAi({ source, title, status = 'info', detail, link }) {
  const req = require('http').request({
    host: '127.0.0.1', port: 62222, path: '/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json' }, timeout: 2000,
  });
  req.on('error', () => {});                       // 永不抛错
  req.end(JSON.stringify({ kind: 'ai', source, title, status, detail, link }));
}
```

### Python
```python
import urllib.request
def notify_ai(source, title, status="info", detail=None, link=None):
    payload = {"kind": "ai", "source": source, "title": title, "status": status}
    if detail: payload["detail"] = detail
    if link:   payload["link"] = link
    req = urllib.request.Request(
        "http://127.0.0.1:62222/hook",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try: urllib.request.urlopen(req, timeout=2)
    except Exception: pass
```

---

## 接入你的 CLI：推荐模式

### 通用原则
在你的 hook / 生命周期事件里调用上面的 `notifyAi(...)`。**把它当成"发完即忘"的副作用**——绝不阻塞、绝不因失败而中断主流程。

### 1) Shell 包装器（最通用）
把发送逻辑封装成一个函数，source 用 CLI 名，title 用当前动作摘要：

```bash
# ~/.local/bin/df-notify (bash)
df_notify() {
  local status="$1" title="$2" detail="${3:-}" link="${4:-}"
  local body="{\"kind\":\"ai\",\"source\":\"$(hostname) CLI\",\"title\":\"$title\",\"status\":\"$status\""
  [ -n "$detail" ] && body+=",\"detail\":\"$detail\""
  [ -n "$link"   ] && body+=",\"link\":\"$link\""
  body+="}"
  curl -s -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" --max-time 2 -d "$body" >/dev/null 2>&1 || true
}
# 用法：构建跑完后
# df_notify success "构建通过" "main #f3a1"
```

在长命令后链式调用：
```bash
npm run build && df_notify success "前端构建通过" || df_notify failure "前端构建失败" "$(tail -n 1 build.log)"
```

### 2) OpenCode（本项目已内置 Agent Notification Protocol）
EpochToDo 自己就用 `scripts/notify_agent.sh`（旧式 `{title,message}`）。要发到 **AI Reminders** 区，改用带 `kind:"ai"` 的版本：
```jsonc
// opencode.json 的 hook 配置示例（伪结构，按你的版本调整）
{
  "hooks": {
    "onTaskComplete": {
      "command": "curl -s -X POST http://127.0.0.1:62222/hook -H 'Content-Type: application/json' -d '{\"kind\":\"ai\",\"source\":\"OpenCode\",\"title\":\"任务完成\",\"status\":\"success\"}' --max-time 2 || true"
    }
  }
}
```

### 3) Claude Code（Stop / SubagentStop hook）
在 `~/.claude/settings.json`（或项目 `.claude/settings.json`）加 Stop hook，用 `jq` 从 stdin 读 `$CLAUDE_*` 环境拼 title：
```jsonc
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "jq -rc '{kind:\"ai\",source:\"Claude Code\",title:(.stop_hook_reason // \"回合结束\"),status:\"info\"}' | curl -s -X POST http://127.0.0.1:62222/hook -H 'Content-Type: application/json' -d @- --max-time 2 || true"
      }]
    }]
  }
}
```

### 4) Cursor / 其它支持 shell command 的 agent
在它的"任务完成 / 暂停"事件里挂同样的 curl。`source` 写你的 agent 名，`title` 写你刚完成的事。

### 5) CI / 构建脚本
构建、部署、批处理跑完发一条：
```yaml
# GitHub Actions step 示例
- name: 通知 EpochToDo
  if: always()
  run: |
    curl -s -X POST http://127.0.0.1:62222/hook \
      -H "Content-Type: application/json" --max-time 2 \
      -d "{\"kind\":\"ai\",\"source\":\"CI\",\"title\":\"部署完成\",\"status\":\"${{ job.status == 'success' && 'success' || 'failure' }}\",\"link\":\"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\"}" || true
  # 注意：CI 在云端，127.0.0.1 指向 runner 自己，需改成用户机器的内网 IP，且 EpochToDo 默认监听 0.0.0.0
```

---

## 安全提示

- 默认绑定 `0.0.0.0:62222`（同局域网可发）。本机自用建议发 `127.0.0.1`。详见 `docs/EXTERNAL_API.md` 的安全章节。
- `link` 强制 `http(s)` 协议白名单，防任意协议（如 `file://`）被打开。
- 不做鉴权、不做来源校验。不要把它暴露到公网。

---

## 调试清单（提醒没出现？）

1. EpochToDo 在跑吗？端口监听？`curl http://127.0.0.1:62222/` 应连上。
2. 用的是 `127.0.0.1` 不是 `localhost`？（IPv6 解析问题）
3. `kind` 是 `"ai"` 吗？漏了会走旧通知路径，不进 AI Reminders 区。
4. `source` / `title` 非空？
5. `status:"success"` 不会出现在 AI Reminders——它会去 **Soft Reminders**（琥珀），检查那里。
6. 看主进程控制台有无 `AI hook error` 日志。
7. 瞬时提醒重启后清空属正常。

---

## 字段速查

```jsonc
// 最小可用
{"kind":"ai","source":"Bot","title":"hi"}

// 完整
{"kind":"ai","source":"Bot","title":"hi","status":"info","detail":"...","link":"https://...","timestamp":1718900000}
```
