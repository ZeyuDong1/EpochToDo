# AI 软提醒设计规格

**日期**: 2026-06-20
**状态**: 已批准
**范围**: 为现有 webhook 通道新增专用的「AI 软提醒」模式，含独立的 Dashboard 面板、Spotlight 卡片，以及完成类自动路由到 Soft Reminders 的行为。

---

## 1. 目标与动机

当前 `/hook` 端点支持两种载荷：训练状态更新与通用通知（`{title, message}` → 触发 Reminder 弹窗）。但 AI 编码助手（OpenCode / Claude Code / Cursor 等）发来的状态提醒语义更丰富（来源、状态、链接），且这类提醒应当是**软的**——不抢焦点、不响铃、不落任务列表。

本设计新增一条专用的 AI 提醒通道：

- **软**：仅刷新两个独立显示区域，绝不触发 Reminder 弹窗或声音
- **瞬时**：非完成类提醒只存内存（重启清空），不入库、不入任务列表
- **可瞥**：Dashboard 与 Spotlight 各有一个常驻独立区域
- **可跟进**：完成类（`success`）提醒自动转为可操作的 Soft Reminder

---

## 2. UX 决策汇总

| 维度 | 决策 |
|------|------|
| 提醒性质 | 软提醒（不响铃、不抢焦点、不触发 Reminder 弹窗） |
| Dashboard 区域 | 替换右栏 Region 2「Training Queue」(`Dashboard/index.tsx:730-758`) 为 AI Reminders 面板，保持 `h-[30%]` |
| Spotlight 区域 | 在「Soft Reminders」卡片(`Spotlight.tsx:812-859`)之后、Footer 之前新增 AI Reminders 卡片 |
| 配色 | AI Reminders 用青色系（`cyan`），与琥珀色（`amber`）Soft Reminders 区分 |
| 完成类路由 | `status === 'success'` 自动建 ad-hoc Task（过期 `target_timestamp`）→ 流入 Soft Reminders（可专注/完成） |
| 非完成类 | `info`/`progress`/`failure`/`needs_input`/`review` 留在 AI Reminders（内存，FIFO 上限 20） |
| 空状态 | Dashboard 显示「暂无 AI 提醒」占位；Spotlight 卡片隐藏 |
| 可点 | 条目若有 `link`，点击用系统默认浏览器打开 |
| 声音 | 无 |
| 落库 | 仅 `success` 路由会建任务；其余不落库 |

---

## 3. Webhook 格式

复用现有端点，新增 `kind: "ai"` 判别符（在 server.ts 中**优先于**现有两种检测判断，向后兼容）。

```http
POST http://127.0.0.1:62222/hook
Content-Type: application/json

{
  "kind": "ai",                       // 必填，判别符
  "source": "Claude Code",            // 必填，来源 agent 名称
  "title": "构建通过",                 // 必填，一句话摘要
  "status": "success",                // 可选，默认 "info"
  "detail": "main #f3a1 · 42 tests",  // 可选，较长说明
  "link": "https://...",              // 可选，外部链接
  "timestamp": 1718900000             // 可选，epoch 秒；缺省由服务端打
}
```

**`status` 枚举与 UI 映射**（均低饱和、不抢眼）：

| status | 含义 | pill 配色 | 去向 |
|--------|------|-----------|------|
| `success` | 某事完成，需查看结果 | emerald | → Soft Reminders（建任务） |
| `failure` | 失败 | rose | AI Reminders（瞬时） |
| `needs_input` | 需要人类输入 | amber | AI Reminders（瞬时） |
| `review` | 代码审查请求 | violet | AI Reminders（瞬时） |
| `info` | 一般信息（默认） | cyan | AI Reminders（瞬时） |
| `progress` | 进行中进度 | cyan | AI Reminders（瞬时） |

**校验**：缺 `source` 或 `title` → 返回 `400` 与错误信息；未知 `status` → 当作 `info`。

### 示例

```bash
# 完成类（→ 自动进 Soft Reminders）
curl -X POST http://127.0.0.1:62222/hook \
  -H "Content-Type: application/json" \
  -d '{"kind":"ai","source":"Claude Code","title":"构建通过","status":"success","detail":"main #f3a1 · 42 tests","link":"https://ci.example.com/run/1"}'

# 一般状态（→ AI Reminders 瞬时）
curl -X POST http://127.0.0.1:62222/hook \
  -H "Content-Type: application/json" \
  -d '{"kind":"ai","source":"Cursor","title":"代码审查请求","status":"review","detail":"pr #142"}'
```

---

## 4. 数据流

```
AI agent ──POST /hook {kind:"ai", ...}──▶ server.ts
                                             │  先判 kind==="ai"
                                             ▼
                                  timerManager.handleAiReminder(data)
                                             │
           ┌─────────────────────────────────┴─────────────────────────────────┐
           ▼ (status === "success")                                       ▼ (其他 status)
  createTask(ad-hoc, status:"waiting",                                    广播 IPC 事件 "ai:reminder"
             target_timestamp = now - 1ms)                                   │  → 所有窗口
        │                                                                   ▼
        ▼                                                          App.tsx 订阅 onAiReminder
  广播 "fetch-tasks"（刷新任务）                                          │  → Zustand pushAiReminder()
        │                                                                   │  (unshift, cap 20 FIFO)
        ▼                                                                   ▼
  进入既有 Soft Reminders 筛选                                 ┌───────────────────────┐
  (type==='ad-hoc' && status==='waiting'                      │ Dashboard AI 面板     │
   && target_timestamp <= now)                               │ Spotlight AI 卡片     │
  → 琥珀色，可专注/完成                                       └───────────────────────┘
```

**多窗口一致性**：所有窗口（dashboard / spotlight / reminder / overlay）均经 `App.tsx` 按 `?type=` 分发，因此 `onAiReminder` 订阅写在 `App.tsx` 即可覆盖全部窗口；只有 Dashboard 与 Spotlight 视图渲染该数据。

---

## 5. 数据模型

### 5.1 类型（`src/shared/types.ts` 新增）

```ts
export type AiReminderStatus =
  | 'success' | 'failure' | 'needs_input' | 'review' | 'info' | 'progress';

export interface AiReminder {
  id: string;            // crypto.randomUUID()
  source: string;        // agent 名称
  title: string;
  status: AiReminderStatus;
  detail?: string;
  link?: string;
  timestamp: number;     // epoch 毫秒
}
```

### 5.2 内存状态（`src/store/useStore.ts` 新增）

```ts
aiReminders: AiReminder[];                    // 默认 []
addAiReminder: (r: AiReminder) => void;       // 头部插入，超过 20 条丢弃尾部
clearAiReminders: () => void;
```

非持久化——DB 仍是任务系统的唯一真相源；AI 提醒仅在内存。

---

## 6. IPC 改动

### 6.1 新增事件通道（`src/shared/ipc-types.ts`）

在 `IpcOnMap`（main → renderer）新增：

```ts
'ai:reminder': { reminder: AiReminder };   // 推送一条新 AI 提醒
```

### 6.2 `electron/preload.ts`

暴露：

```ts
onAiReminder: (cb: (reminder: AiReminder) => void) => () => void;
```

返回取消订阅函数，与现有 `onX` 方法一致。

### 6.3 打开外链（新增 invoke 通道）

在 `IpcInvokeMap` 新增 `open-external`，main 中调用 `shell.openExternal(url)`。点击带 `link` 的 AI 条目时调用。

---

## 7. 主进程改动

### 7.1 `electron/server.ts`

在现有 `isTrainingUpdate` 判断**之前**插入 AI 分支：

```ts
if (data.kind === 'ai') {
  deps.timerManager.handleAiReminder(data);
  res.writeHead(200); res.end(JSON.stringify({ ok: true }));
  return;
}
```

校验在 `handleAiReminder` 内做（缺字段抛错 → server 捕获返回 400）。

### 7.2 `electron/timer/manager.ts` 新增 `handleAiReminder(data)`

```ts
async handleAiReminder(data: any) {
  const source = String(data.source ?? '').trim();
  const title  = String(data.title ?? '').trim();
  if (!source || !title) throw new Error('ai reminder requires source and title');

  const status: AiReminderStatus = ['success','failure','needs_input','review','progress']
    .includes(data.status) ? data.status : 'info';

  if (status === 'success') {
    // 完成类 → 建 ad-hoc 任务，过期 target 使其立即成为 Soft Reminder
    await createAdHocSoftReminder({ source, title, detail, link });
    this.broadcast('fetch-tasks', undefined);
    return;
  }

  const reminder: AiReminder = {
    id: crypto.randomUUID(),
    source, title, status, detail, link,
    timestamp: data.timestamp ? data.timestamp * 1000 : Date.now(),
  };
  this.broadcast('ai:reminder', { reminder });
}
```

`createAdHocSoftReminder`：调用既有任务创建服务建一个 `type: 'ad-hoc'`、`status: 'waiting'`、`target_timestamp = new Date(Date.now() - 1)` 的任务，标题形如 `🤖 ${source} · ${title}`，`detail`/`link` 写入 `context_memo`。复用现有 `triggerExternalNotification` 创建负 id 合成任务的相反路径——这里走真实落库（`db/service.ts` 的 createTask），与 training 完成建「Check results」任务的模式一致。

---

## 8. 渲染层改动

### 8.1 `src/App.tsx`

仿照现有 `onTrainingUpdate` 订阅（`App.tsx:22-26`），新增：

```ts
useEffect(() => {
  const unsub = window.api.onAiReminder((reminder) => useStore.getState().addAiReminder(reminder));
  return unsub;
}, []);
```

### 8.2 Dashboard — 替换 Region 2（`Dashboard/index.tsx`）

将 `730-758` 行的「Training Queue」整段替换为 AI Reminders 面板：

- 外层容器保留 `h-[30%] border-b ... flex flex-col overflow-hidden`
- 头部：`🤖 AI Reminders`，cyan 系（`text-cyan-400`），右上角可选条数徽标
- 列表：从 `useStore` 读 `aiReminders`，每行渲染 `[status pill] source · title · (detail) ... 相对时间`
- 空状态：`text-gray-700 text-[10px] italic text-center mt-4` 显示「暂无 AI 提醒」
- 点击行：若有 `link` → `window.api.openExternal(link)`；否则不响应
- 移除对 `trainingQueue` 的依赖（该变量若仅此处使用则一并清理）

### 8.3 Spotlight — 新增 AI Reminders 卡片（`Spotlight.tsx`）

在第 `859` 行（Soft Reminders 卡片闭合）之后、第 `861` 行 Footer 之前插入。结构仿照 Soft Reminders 卡片，但用 cyan 系：

```tsx
{!selectGpuMode && aiReminders.length > 0 && (
  <div className="mx-4 my-3 rounded-xl border border-cyan-500/40 bg-cyan-500/[0.07] ...">
    <div className="... text-cyan-300 ...">
      <Bot size={11} /> AI Reminders
      <span className="ml-auto ...">{aiReminders.length}</span>
    </div>
    <div className="divide-y divide-cyan-500/10">
      {aiReminders.map(r => ( /* status pill + source + title + 相对时间；点击 openExternal */ ))}
    </div>
  </div>
)}
```

- 空时整卡隐藏（与 Soft Reminders 一致）
- 相对时间用简单格式（`刚刚` / `Nm` / `Nh`），可内联小工具函数

### 8.4 status → pill 映射

| status | class |
|--------|-------|
| success | `bg-emerald-500/20 text-emerald-300` |
| failure | `bg-rose-500/20 text-rose-300` |
| needs_input | `bg-amber-500/20 text-amber-300` |
| review | `bg-violet-500/20 text-violet-300` |
| info / progress | `bg-cyan-500/20 text-cyan-300` |

抽一个 `aiStatusPill(status)` 小函数复用于 Dashboard 与 Spotlight。

---

## 9. 改动文件清单

| 文件 | 改动 |
|------|------|
| `electron/server.ts` | 新增 `kind==="ai"` 分支（优先于现有检测） |
| `electron/timer/manager.ts` | 新增 `handleAiReminder` + `createAdHocSoftReminder` |
| `electron/main.ts` | 注册 `open-external` IPC handler（`shell.openExternal`） |
| `electron/preload.ts` | 暴露 `onAiReminder`、`openExternal` |
| `src/shared/ipc-types.ts` | `IpcOnMap` 加 `ai:reminder`；`IpcInvokeMap` 加 `open-external` |
| `src/shared/types.ts` | 新增 `AiReminder`、`AiReminderStatus` |
| `src/global.d.ts` | `IElectronAPI` 加 `onAiReminder`、`openExternal` |
| `src/store/useStore.ts` | 新增 `aiReminders` + `addAiReminder`/`clearAiReminders` |
| `src/App.tsx` | 订阅 `onAiReminder` 入 store |
| `src/renderer/components/Dashboard/index.tsx` | 替换 Region 2 Training Queue → AI Reminders 面板 |
| `src/renderer/components/Spotlight.tsx` | Soft Reminders 后新增 AI Reminders 卡片 |
| 新增 `src/renderer/utils/aiStatus.ts`（或并入既有 utils） | `aiStatusPill`、相对时间格式化 |

---

## 10. 错误处理

- **载荷校验失败**（缺 `source`/`title`）：`handleAiReminder` 抛错，`server.ts` 捕获后返回 `400 { error }` 并 `console.error`
- **未知 status**：降级为 `info`，不报错
- **建任务失败**（success 路由）：`try/catch`，失败则 `console.error` 并回退为普通瞬时 `ai:reminder` 广播，保证用户仍能看到提醒
- **timestamp 非法**：用服务端 `Date.now()` 兜底

---

## 11. 不做（YAGNI）

- 不为 AI 提醒新建 DB 表（除 success 路由建任务外）
- 不加开关/设置项（本就是软提醒，无需关闭）
- `failure`/`needs_input`/`review` 不自动路由到 Soft Reminders（仅 `success`，按用户决定）
- 不发声音、不触发 Reminder 弹窗、不抢焦点
- 不做 AI 提醒的持久历史/搜索（瞬时即弃）
- 不做 webhook 鉴权（沿用现状；`docs/EXTERNAL_API.md` 已有安全说明）

---

## 12. 验收标准

1. `curl` 发 `kind:"ai"` + `status:"info"` → Dashboard 青色面板与 Spotlight 青色卡片同时出现该条；不发声音、不弹 Reminder
2. `curl` 发 `status:"success"` → Soft Reminders（琥珀）出现一条可专注/可完成的项目，Dashboard Ad-Hoc 区亦可见；AI Reminders 不出现该条
3. 缺 `source` 或 `title` → HTTP 400
4. 重启应用 → AI Reminders 清空；Soft Reminders 中 success 路由的任务保留（已落库）
5. 收到超过 20 条非完成类提醒 → 仅保留最新 20 条（FIFO）
6. 点击带 `link` 的条目 → 系统浏览器打开
7. 空 AI Reminders：Dashboard 显示「暂无 AI 提醒」；Spotlight 卡片隐藏
8. `npm run lint` 通过
