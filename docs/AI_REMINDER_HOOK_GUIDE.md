# AI 任务提醒 Hook 接入指南

> **给 AI 助手看：** 读这一份文件就能把你的 CLI / agent 接到 EpochToDo，把任务状态作为「软提醒」推到用户的桌面。无需 API Key、无需认证，发一个 HTTP POST 即可。

---

## 这是什么

EpochToDo 是一个 Electron 桌面任务管理器，监听本地 HTTP webhook。AI 编码助手（OpenCode / Claude Code / Cursor / 自定义脚本）可以在**长任务完成、构建/测试出结果、需要人类输入、请求代码审查**等时刻，发一条提醒过来。

提醒是**软的**：不响铃、不抢焦点、不弹模态窗。它只刷新两个位置——
- **主界面（Dashboard）右栏**「AI Reminders」面板（青色）
- **Spotlight（Alt+Space 悬浮窗）** 里「Soft Reminders」下方的「AI Reminders」卡片

---

## 核心原则：能自己干完的事，不要打扰用户

> **判断准则**：如果你（agent）可以**自动完成**某件事、不需要用户点击/审批/决策，就**不要**发 webhook。只在**需要用户介入**时才发。

这条原则比所有字段规范都重要——它的目标是让用户**只在真需要他的时候**被打扰。

### 该发 ✅

| 场景 | 为什么 |
|------|--------|
| 长任务跑完，结果需要用户看一眼决定下一步 | 用户在等这个结果 |
| 构建/测试失败，需要用户排查 | 阻塞，用户必须介入 |
| 卡住等用户回复/确认（如二选一方案） | 你无法自决 |
| 产出代码/PR 等待审查 | 需要人类审阅 |
| 部署/迁移等不可逆操作前的最后确认 | 风险高，需人类拍板 |

### 不该发 ❌

| 场景 | 为什么 |
|------|--------|
| 你自己读文件、查文档、思考 | 内部步骤，用户不关心 |
| 你能自动审批/自动批准的操作（如 lint auto-fix、format、安装依赖、写测试） | 你自己能干完，用户不需要参与 |
| 进度的每个微小变化（每写一行代码、每跑一个工具） | 噪音，挤掉真正重要的提醒 |
| 你已经决定要做的常规动作（commit、push、PR 创建） | 信息性事件 ≠ 需要用户介入 |
| 同一件事的第 N 次重复通知 | 用户已经知道了 |

### 一句话自检

发之前问自己一句：**「用户看到这条提醒后，需要做某个动作吗？」**
- 答「需要」→ 发，并用对应 `status`（`success`/`failure`/`needs_input`/`review`）
- 答「不需要，只是告诉他一声」→ **不发**，或最多用 `info`/`progress` 在显著节点发一次

---

## 端点

```
POST http://127.0.0.1:62222/hook
Content-Type: application/json; charset=utf-8
```

- 端口固定 `62222`，绑定本机。**用 `127.0.0.1`**（不要用 `localhost`，某些系统会先解析成 IPv6 `::1` 导致连接拒绝）。
- 无需鉴权。服务随 EpochToDo 启动而启动；EpochToDo 没开时请求会失败（忽略错误即可，不要阻塞你的主流程）。
- **总是非阻塞地发送**：建议设短超时（如 2 秒）并吞掉失败，提醒失败不应影响你的主任务。
- **编码（重要，否则中文乱码）**：请求体必须是 **UTF-8 编码的 JSON**（JSON 规范默认即 UTF-8）。建议带 `Content-Type: application/json; charset=utf-8`。**不要发送 GBK / GB2312 / 其它编码**——EpochToDo 按 UTF-8 解码，非 UTF-8 的中文会变成乱码。若你的运行时（PowerShell、某些 CLI）默认按系统代码页（GBK）编码字符串，务必在序列化/发送前显式转成 UTF-8 字节。

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
| `timestamp` | ❌ | number | Unix **秒或毫秒均可**（>1e12 视作毫秒，否则按秒，自动识别）。缺省用服务端当前时间。 |

### status 语义（重要）

> **路由由发送方决定，代码不推断意图。** 你传什么 `status`，提醒就去对应栏目——`success` / `needs_input` / `review` → **硬提醒**（可操作、会持久化、弹窗+提示音）；`progress` / `info` / `failure` → **AI 提醒**（内存留存，重启清空）。**不传 `status` 时默认 `info` → 留 AI 提醒。**
>
> 所以："已完成"要进软提醒，**必须**主动发 `status:"success"`；"开始工作"要留 AI 提醒，发 `status:"progress"`。**别指望 EpochToDo 替你判断**——它只读你传的 `status` 字段。

`status` 决定提醒**去哪**以及**配色**：

| status | 含义 | 去向 | 配色 |
|--------|------|------|------|
| `success` | 某事完成，需用户查看结果 | **自动转为可操作任务，进入 Soft Reminders（琥珀），可专注/完成** | 绿 |
| `failure` | 失败 | AI Reminders（内存留存） | 玫红 |
| `needs_input` | 需要人类输入 / 权限 / 卡住等回复 | **同 success，进入 Soft Reminders（可操作）** | 琥珀 |
| `review` | 请求代码审查 | **同 success，进入 Soft Reminders（可操作）** | 紫 |
| `info` | 一般信息（默认） | AI Reminders（内存留存） | 青 |
| `progress` | 进行中进度 | AI Reminders（内存留存） | 青 |

- **AI 提醒（内存留存）**：进入后常驻 Dashboard / Spotlight 的 AI 栏（最近 20 条，新的在前），**不会自动消失**；不入库、不入任务列表，重启 EpochToDo 后清空。可手动 ✓ 忽略或转为软提醒。
- **`success` / `needs_input` / `review`**：会落库成一个 ad-hoc 任务（标题 `🤖 {source} · {title}`），进入 Soft Reminders，用户可对它**开始专注**或**完成**；这是仅有的会持久化的情况（其余状态仅存内存，重启清空）。

> 路由总览：**需用户行动**（`success` 已完成 / `needs_input` 要权限或输入 / `review` 待审查）→ 进 **Soft Reminders**（可专注/完成，会持久化）；**仅状态**（`progress` 开始工作 / `info` / `failure`）→ 留 **AI Reminders**（内存留存，重启清空）。

### 同一回复的多 status 行为（重要）

实际场景里 agent 经常对**同一件事**发多条提醒：先 `progress`（开始跑）→ 再 `info`（中间状态）→ 最后 `success`/`failure`（结果）。这些提醒有相同的 `source` + `title`，EpochToDo 视它们为**同一回复（same reply）**。

当用户对其中一条 AI 提醒（内存卡）点「Promote / 传入完成」（即把它升级为 Soft Reminder 任务）时，EpochToDo 会**自动清除同一回复的其他 AI 提醒**，避免「同一件事 3 条卡片，已经处理了但还有 2 条亮着」的噪音。

**例外**：status 为 `needs_input` 或 `review` 的提醒**不会被清除**——它们代表「需要用户立刻操作」，必须保留直到用户主动处理。

匹配规则：`source === source && title === title`（精确字符串相等）。如果你的 agent 想让多条提醒被识别为同一回复，**用完全相同的 source + title**；反之改一个字就会被视为不同回复。

| 用户操作 | 结果 |
|---------|------|
| 点 `info`/`progress`/`failure`/`success` 之一的「Promote」 | 该条消失 → 创建 ad-hoc task；同 reply 的其他 info/progress/failure/success 也消失 |
| 点 `needs_input`/`review` 的「Promote」 | 该条消失 → 创建 ad-hoc task；同 reply 的其他 AI 提醒清除；**其他 needs_input/review 保留** |
| 单纯点「忽略（dismiss）」单条 | 只删那一条，不动其他 |

---

## 取消已发的提醒（`kind:"ai-dismiss"`）

场景：你之前发了「等用户回复」（`needs_input`）或「构建完成」（`success`），但用户回到对话继续说了几句话，问题已经解决 / 结果用户已经看到了——这时**过时的提醒卡还挂在界面上**。发一条 `ai-dismiss` 就能把它们撤下来，闭合「发提醒 → 已回应 → 自动清理」的循环。

```jsonc
{
  "kind": "ai-dismiss",               // 必填，固定为 "ai-dismiss"
  "source": "Claude Code",            // 与发送时的 source 一致
  "title": "需要确认迁移方案",          // 与发送时的 title 一致（精确匹配）
  "force": false                      // 可选，见下表
}
```

**匹配规则**：`source` 和 `title` 至少给一个，都可给（都给则同时满足才命中；只给 `source` 会清除该来源的**所有**硬提醒任务，慎用）。只清理本集成创建的 `🤖 {source} · {title}` 任务，用户自己的任务永不受影响。同时向所有窗口广播，让内存中的 AI 提醒卡（Dashboard / Spotlight / 悬浮窗）原地消失。

| 参数 | 效果 |
|------|------|
| 默认（`force` 缺省/`false`） | 删除已持久化的硬提醒任务；内存卡中的 info/progress/failure 一并清除；**needs_input / review 卡保留**（可能仍需用户操作） |
| `force: true` | 上述全部 + **needs_input / review 卡也清除**——仅当你确认用户已经回应过该问题时使用 |

响应：`{ "success": true, "dismissed_tasks": <n> }`（`n` = 删除的持久化任务数，0 也算成功）。`source` 和 `title` 都不给会返回 400。

> 典型时序：agent 发 `needs_input` → 用户在对话里回答 → agent 收到回答后**顺手发一条 `ai-dismiss`（`force:true`）**，那条「等你回复」的卡就自动消失了，用户不用手动清理。

---

## 编写优质提醒（给 AI 的内容规范）

一条好提醒让用户**瞥一眼就知道发生了什么、要不要管**；一条差提醒只是噪音。发送前按本节构造字段。

### `title` —— 一句话讲清「对象 + 结果」
- ✅ 具体到对象与结果：`构建通过 · main #f3a1`、`修复登录崩溃 (auth.ts)`、`42/42 测试通过`
- ❌ 空泛词：`任务完成` / `done` / `完成` / `出错了` / `有更新` —— 用户无法区分多条
- 控制在约 30 字内；更长内容放 `detail`。不要放完整路径或整句。
- 用**结果或动词**开头；不要用「我」「AI」开头（来源已在 `source` 里）。

### `detail` —— 一行的分流信息
- 放能帮用户**决定是否现在处理**的信息：数量汇总、最关键的一行错误、分支/PR、影响范围。
- ✅ `42 tests · 0 failed · 12.3s`、`TypeError in parseConfig (src/config.ts:88)`、`pr #142 · +128 -34`
- ❌ 整段日志、完整堆栈、冗长叙述 —— 详情用 `link` 指向日志。
- 单行；可在开头放关键数字（`12/12`、`+5`、`-2`）。

### `status` —— 按结果分流
- 任务/构建/测试**跑完且成功** → `success`（进 Soft Reminders，可专注/完成）
- **卡住 / 等用户回复 / 要权限** → `needs_input`（同样进 Soft Reminders，需用户处理）
- **失败 / 崩溃** → `failure`（留 AI Reminders）
- **产出待审查**（PR / 代码 / 方案）→ `review`（同进 Soft Reminders，需用户处理）
- **开始工作 / 进行中 / 心跳** → `progress`（留 AI Reminders）；其余一般信息 → `info`

### `link` —— 有就给
- 凡有可跳转的上下文（CI run、PR、commit、日志、issue），都填 `link`，用户点条目即打开。**没有就省略，不要编造 URL。**

### `source` —— 稳定身份
- 用一个稳定的 agent / 脚本名（`Claude Code`、`Cursor`、`build-bot`、`CI`），不要每条换；用户靠它识别来源。

### 节制原则（避免噪音）

核心原则已说「需要用户介入才发」。补充几条具体约束：

- **一个有意义的工作单元发一条**：一次完整构建、一个审查请求、一次需要决策的卡点——不是每个工具调用都发。
- 无需通知的内部步骤（读文件、查文档、思考）**不要发**。
- AI 提醒只保留最近 20 条（仅存内存，不自动清除）——泛滥会挤掉有用信息。
- 进度只在**显著节点**发（如 `训练 50%`、`已处理 100/200 文件`），不要每个百分点都发。
- **同一件事不要重复通知**：用户已知的事不要再次推送（参见上方「同一回复的多 status 行为」）。

### 好 ✅ vs 差 ❌

| 场景 | ❌ 差 | ✅ 好 |
|------|-------|-------|
| 构建成功 | `title:"完成"` | `title:"构建通过 · main"`, `detail:"42 tests · 0 failed"`, `link:<ci>`, `status:"success"` |
| 构建失败 | `title:"出错了"` | `title:"构建失败 · main #f3a1"`, `detail:"TypeError in config.ts:88"`, `link:<log>`, `status:"failure"` |
| 等用户决定 | `title:"看一眼"` | `title:"需要确认迁移方案"`, `detail:"2 个选项，见对话"`, `status:"needs_input"` |
| 代码审查 | `title:"代码"` | `title:"代码审查请求 · auth 重构"`, `detail:"pr #142 · +128 -34"`, `link:<pr>`, `status:"review"` |
| 进度 | 每秒 `status:"progress"` | `title:"训练 50% · loss 0.23"`, `status:"progress"`（仅显著节点） |

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
      "command": "curl -s -X POST http://127.0.0.1:62222/hook -H 'Content-Type: application/json' -d '{\"kind\":\"ai\",\"source\":\"OpenCode\",\"title\":\"重构 auth 模块完成\",\"status\":\"success\",\"detail\":\"3 文件 · 测试通过\"}' --max-time 2 || true"
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
7. AI 提醒重启后清空属正常（仅存内存，不落库）。

---

## 字段速查

```jsonc
// 最小可用
{"kind":"ai","source":"Bot","title":"hi"}

// 完整
{"kind":"ai","source":"Bot","title":"hi","status":"info","detail":"...","link":"https://...","timestamp":1718900000}
```
