# AI 软提醒 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为现有 `/hook` webhook 通道新增专用的「AI 软提醒」模式，在 Dashboard（替换 Training Queue）与 Spotlight（Soft Reminders 卡片下方）各设一个独立显示区，完成类（`success`）自动转为 Soft Reminder。

**架构：** webhook 收到 `kind:"ai"` → `TimerManager.handleAiReminder`：`success` 建一个 ad-hoc 任务 + 过期 wait 定时器（流入既有 Soft Reminders）；其余状态广播新 IPC 事件 `ai:reminder` → 各窗口 `App.tsx` 订阅写入 Zustand `aiReminders`（内存，FIFO 上限 20）→ Dashboard / Spotlight 渲染。

**技术栈：** Electron 30 + React 18 + TypeScript + Zustand + Kysely/better-sqlite3 + Tailwind。**无测试框架**（AGENTS.md），验证 = `npm run lint` + 手动 curl + `npm run dev` 观察 UI。

**规格：** `docs/superpowers/specs/2026-06-20-ai-soft-reminders-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/shared/types.ts` | `AiReminder` / `AiReminderStatus` 类型 | 修改（追加） |
| `src/shared/ipc-types.ts` | `ai:reminder` 事件 + `open-external` invoke 声明 | 修改 |
| `src/global.d.ts` | `IElectronAPI` 加 `onAiReminder` / `openExternal` | 修改 |
| `electron/preload.ts` | 暴露 `onAiReminder` / `openExternal` | 修改 |
| `electron/main.ts` | 注册 `open-external` handler | 修改 |
| `src/store/useStore.ts` | `aiReminders` 状态 + actions | 修改 |
| `src/App.tsx` | 订阅 `onAiReminder` 入 store | 修改 |
| `electron/timer/manager.ts` | `handleAiReminder` + `createAiSoftReminder` | 修改 |
| `electron/server.ts` | `kind==="ai"` 分支 | 修改 |
| `src/renderer/utils/aiStatus.ts` | `aiStatusPill` + `formatRelativeTime` | 新建 |
| `src/renderer/components/Dashboard/index.tsx` | Region 2 Training Queue → AI Reminders 面板 | 修改 |
| `src/renderer/components/Spotlight.tsx` | Soft Reminders 后新增 AI Reminders 卡片 | 修改 |

**依赖顺序：** 类型（任务1）→ IPC 声明（任务2）→ preload/main（任务3-4）→ store（任务5）→ App 订阅（任务6）→ 主进程处理（任务7-8）→ UI 工具（任务9）→ Dashboard（任务10）→ Spotlight（任务11）→ 全量验证（任务12）。

---

## 任务 1：新增 AiReminder 类型

**文件：**
- 修改：`src/shared/types.ts`（在文件末尾 `TaskNode` 接口之后追加）

- [ ] **步骤 1：追加类型定义**

在 `src/shared/types.ts` 末尾（第 113 行 `TaskNode` 接口的闭合之后）追加：

```ts
export type AiReminderStatus =
  | 'success' | 'failure' | 'needs_input' | 'review' | 'info' | 'progress';

export interface AiReminder {
  id: string;
  source: string;
  title: string;
  status: AiReminderStatus;
  detail?: string;
  link?: string;
  timestamp: number; // epoch ms
}
```

- [ ] **步骤 2：运行 lint 验证**

运行：`npm run lint`
预期：PASS（纯类型新增，无破坏）

- [ ] **步骤 3：Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(ai): add AiReminder types"
```

---

## 任务 2：IPC 声明（事件 + invoke）

**文件：**
- 修改：`src/shared/ipc-types.ts`
- 修改：`src/global.d.ts`

- [ ] **步骤 1：在 `ipc-types.ts` 顶部 import 加入 `AiReminder`**

把第 1 行：
```ts
import type { Task, TaskType, Project, HistoryEntry, Gpu, TrainingStatus, SchedulerGpu, SchedulerTask, SchedulerAssignment } from './types';
```
改为：
```ts
import type { Task, TaskType, Project, HistoryEntry, Gpu, TrainingStatus, SchedulerGpu, SchedulerTask, SchedulerAssignment, AiReminder } from './types';
```

- [ ] **步骤 2：在 `IpcInvokeMap` 末尾加 `open-external`**

在 `IpcInvokeMap` 的 `'wandb:test'` 行（第 41 行）之后、闭合 `};`（第 42 行）之前插入：

```ts
  'open-external': { args: [url: string]; return: void };
```

- [ ] **步骤 3：在 `IpcOnMap` 末尾加 `ai:reminder`**

在 `IpcOnMap` 的 `'timer:training-update'` 行（第 65 行）之后、闭合 `};`（第 66 行）之前插入：

```ts
  'ai:reminder': (reminder: AiReminder) => void;
```

- [ ] **步骤 4：在 `global.d.ts` 补 IElectronAPI**

把第 1 行 import 改为（加入 `AiReminder`）：
```ts
import { Task, Project, HistoryEntry, Gpu, TrainingStatus, SchedulerGpu, SchedulerTask, SchedulerAssignment, AiReminder } from './shared/types';
```

在 `IElectronAPI` 中 `onTrainingUpdate` 行（第 51 行）之后加入：
```ts
  onAiReminder: (callback: (reminder: AiReminder) => void) => () => void;
  openExternal: (url: string) => Promise<void>;
```

- [ ] **步骤 5：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/shared/ipc-types.ts src/global.d.ts
git commit -m "feat(ai): add ai:reminder event and open-external ipc decls"
```

---

## 任务 3：preload 暴露新 API

**文件：**
- 修改：`electron/preload.ts`

- [ ] **步骤 1：在 `onTrainingUpdate` 行（第 66 行）之后加入 `onAiReminder`**

```ts
  onAiReminder: (callback: (reminder: any) => void) => on('ai:reminder', callback),
```

- [ ] **步骤 2：在 `wandbTest` 行（第 72 行）之后加入 `openExternal`**

```ts
  openExternal: (url: string) => invoke('open-external', url),
```

- [ ] **步骤 3：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add electron/preload.ts
git commit -m "feat(ai): expose onAiReminder and openExternal in preload"
```

---

## 任务 4：main 注册 open-external handler

**文件：**
- 修改：`electron/main.ts`

- [ ] **步骤 1：import shell**

把第 1 行：
```ts
import { app, BrowserWindow, ipcMain, globalShortcut, Menu, screen, dialog } from 'electron'
```
改为：
```ts
import { app, BrowserWindow, ipcMain, globalShortcut, Menu, screen, dialog, shell } from 'electron'
```

- [ ] **步骤 2：注册 handler**

在 `app.whenReady().then(...)` 块内、`createHookServer(...)` 调用之前（约第 117 行 `const broadcastFetchTasks = ...` 之后的位置，或任意 `handleIpc(...)` 注册区）加入：

```ts
  handleIpc('open-external', async (url: string) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
    }
  });
```

注意：`handleIpc` 是 `main.ts:21` 定明的封装，自动 try/catch。URL 协议白名单防任意协议打开。

- [ ] **步骤 3：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add electron/main.ts
git commit -m "feat(ai): register open-external ipc handler"
```

---

## 任务 5：Zustand store 增加 aiReminders

**文件：**
- 修改：`src/store/useStore.ts`

- [ ] **步骤 1：import AiReminder**

把第 2 行：
```ts
import { TrainingStatus } from '../shared/types';
```
改为：
```ts
import { TrainingStatus, AiReminder } from '../shared/types';
```

- [ ] **步骤 2：在 `TimerState` 接口加状态与 actions**

在 `setTrainingStatus: (status: TrainingStatus) => void;`（第 27 行）之后加入：

```ts
  aiReminders: AiReminder[];
  addAiReminder: (reminder: AiReminder) => void;
  clearAiReminders: () => void;
```

- [ ] **步骤 3：在 `create<TimerState>()((set) => ({ ... }))` 内加初始值与实现**

在 `trainingStatus: {},`（第 33 行）之后加入初始值：

```ts
  aiReminders: [],
```

在 `setTrainingStatus` 实现的闭合（第 69 行 `})),` 之前，即 `setTrainingStatus` 函数体之后）加入：

```ts
  ,

  addAiReminder: (reminder) => set((state) => ({
    aiReminders: [reminder, ...state.aiReminders].slice(0, 20),
  })),

  clearAiReminders: () => set({ aiReminders: [] }),
```

注意：`[reminder, ...state.aiReminders].slice(0, 20)` —— 头部插入最新，FIFO 丢弃超过 20 条的尾部。

- [ ] **步骤 4：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/store/useStore.ts
git commit -m "feat(ai): add aiReminders in-memory store (FIFO cap 20)"
```

---

## 任务 6：App.tsx 订阅 ai:reminder

**文件：**
- 修改：`src/App.tsx`

- [ ] **步骤 1：在现有 onTrainingUpdate 订阅之后加 onAiReminder**

把第 14-32 行的 `useEffect` 内，在 `setIsReady(true);`（第 28 行）之前加入第二个 cleanup：

```ts
    let aiCleanup: (() => void) | undefined;
    if (window.api?.onAiReminder) {
      aiCleanup = window.api.onAiReminder((reminder) => {
        useStore.getState().addAiReminder(reminder);
      });
    }
```

把 return 的 cleanup（第 29-31 行）改为同时调用两个：

```ts
    return () => {
      cleanup?.();
      aiCleanup?.();
    };
```

（依赖数组 `[setTrainingStatus]` 保持不变；`addAiReminder` 经 `useStore.getState()` 调用，无需进依赖。）

- [ ] **步骤 2：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/App.tsx
git commit -m "feat(ai): subscribe to ai:reminder events into store"
```

---

## 任务 7：TimerManager.handleAiReminder

**文件：**
- 修改：`electron/timer/manager.ts`

- [ ] **步骤 1：import randomUUID**

在文件顶部第 1-5 行的 import 区，加入：
```ts
import { randomUUID } from 'node:crypto';
```

- [ ] **步骤 2：import AiReminder 类型**

把第 6 行之后加入（或并入既有 `import { WandbRunFull }` 下方）：
```ts
import { AiReminder, AiReminderStatus } from '../../src/shared/types';
```

- [ ] **步骤 3：实现 handleAiReminder 与 createAiSoftReminder**

在 `triggerExternalNotification` 方法之后（文件末尾，第 1112 行 `this.notify('timer:ended', notificationId, task);` 之后、类闭合 `}` 之前）加入：

```ts
  async handleAiReminder(data: Record<string, unknown>): Promise<void> {
    const source = String(data.source ?? '').trim();
    const title = String(data.title ?? '').trim();
    if (!source || !title) {
      throw new Error('ai reminder requires "source" and "title"');
    }

    const known: AiReminderStatus[] = ['success', 'failure', 'needs_input', 'review', 'progress'];
    const status: AiReminderStatus = known.includes(data.status as AiReminderStatus)
      ? (data.status as AiReminderStatus)
      : 'info';

    const detail = data.detail != null ? String(data.detail) : undefined;
    const link = typeof data.link === 'string' ? data.link : undefined;
    const ts = typeof data.timestamp === 'number'
      ? data.timestamp * 1000
      : Date.now();

    // 完成类 → 建可操作的 ad-hoc 任务（过期 wait 定时器）→ 流入 Soft Reminders
    if (status === 'success') {
      try {
        await this.createAiSoftReminder({ source, title, detail, link });
        return; // createAiSoftReminder 内部已广播 fetch-tasks
      } catch (err) {
        console.error('[TimerManager] createAiSoftReminder failed, fallback to ephemeral:', err);
        // 失败回退为瞬时提醒，保证用户仍能看到
      }
    }

    const reminder: AiReminder = {
      id: randomUUID(),
      source,
      title,
      status,
      detail,
      link,
      timestamp: ts,
    };
    this.notify('ai:reminder', reminder);
  }

  // 建 ad-hoc 任务 + 过期 wait 定时器，使其立即成为 Soft Reminder（琥珀、可专注/完成）。
  // 复用既有 startWait 的 DB 写入模式，但 target 设为过去，且不调度内存回调。
  private async createAiSoftReminder(payload: {
    source: string; title: string; detail?: string; link?: string;
  }): Promise<void> {
    const taskTitle = `🤖 ${payload.source} · ${payload.title}`;
    const memo = [payload.detail, payload.link].filter(Boolean).join('\n') || null;

    const task = await TaskService.createTask(taskTitle, undefined, 'ad-hoc', undefined, undefined, true);

    if (memo) {
      await TaskService.updateTask(task.id, { context_memo: memo });
    }

    // 过期 wait 定时器（过去 1 秒）→ 立即满足 softReminders 筛选条件
    await db.deleteFrom('timers').where('task_id', '=', task.id).execute();
    await db.insertInto('timers')
      .values({
        task_id: task.id,
        type: 'wait',
        target_timestamp: new Date(Date.now() - 1000).toISOString(),
        original_duration: 0,
        started_at: new Date().toISOString(),
      })
      .execute();

    await db.updateTable('tasks')
      .set({ status: 'waiting' })
      .where('id', '=', task.id)
      .execute();

    this.notify('fetch-tasks');
  }
```

说明：
- `TaskService.createTask(..., true)` 第 6 参 `skipDedup=true`，避免与同名任务碰撞返回旧任务。
- 不调用 `scheduleWaitCompletion`（target 已是过去；且 ad-hoc 在 broadcaster 中走 soft 路径，不弹 Reminder）。
- `this.notify('fetch-tasks')` 让所有窗口刷新任务列表，Soft Reminders 自然出现该条。

- [ ] **步骤 4：确认 TaskService.updateTask 存在**

运行：`rg -n "async updateTask" electron/db/service.ts`
预期：命中（`TaskService.updateTask` 已存在，Dashboard/Spotlight 都在用）。若不存在则需补，但既有代码大量调用它，应已存在。

- [ ] **步骤 5：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add electron/timer/manager.ts
git commit -m "feat(ai): handleAiReminder + createAiSoftReminder in TimerManager"
```

---

## 任务 8：server.ts 加 kind==="ai" 分支

**文件：**
- 修改：`electron/server.ts`

- [ ] **步骤 1：在 isTrainingUpdate 判断之前插入 AI 分支**

在 `const data = JSON.parse(body)`（第 26 行）之后、`const isTrainingUpdate = ...`（第 28 行）之前插入：

```ts

          if (data.kind === 'ai') {
            try {
              await deps.timerManager.handleAiReminder(data);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true }));
            } catch (e) {
              console.error('AI hook error:', e);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: (e as Error).message }));
            }
            return;
          }
```

说明：置于训练/通用通知检测**之前**，`kind:"ai"` 优先匹配；现有两类载荷不含 `kind` 字段，向后兼容。

- [ ] **步骤 2：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 3：手动验证（端到端 main 进程）**

启动：`npm run dev`，等 Electron 起来后，新开终端运行：
```bash
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d "{\"kind\":\"ai\",\"source\":\"Test\",\"title\":\"hello\",\"status\":\"info\"}"
```
预期：HTTP 200，返回 `{"success":true}`。主进程控制台无错误。

再测校验失败：
```bash
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d "{\"kind\":\"ai\",\"source\":\"Test\"}"
```
预期：HTTP 400，返回含 `"requires \"source\" and \"title\""` 的 error。

（此时 UI 还未渲染——下个任务才接 UI。此步只验 main 链路。）

- [ ] **步骤 4：Commit**

```bash
git add electron/server.ts
git commit -m "feat(ai): route kind=ai payloads to handleAiReminder"
```

---

## 任务 9：UI 工具函数（status pill + 相对时间）

**文件：**
- 创建：`src/renderer/utils/aiStatus.ts`

- [ ] **步骤 1：确认 utils 目录**

运行：`if (Test-Path "src/renderer/utils") { "EXISTS" } else { New-Item -ItemType Directory -Path "src/renderer/utils" -Force | Out-Null; "CREATED" }`

- [ ] **步骤 2：创建 `src/renderer/utils/aiStatus.ts`**

```ts
import type { AiReminderStatus } from '../../shared/types';

export function aiStatusPill(status: AiReminderStatus): { label: string; className: string } {
  switch (status) {
    case 'success':
      return { label: '✓', className: 'bg-emerald-500/20 text-emerald-300' };
    case 'failure':
      return { label: '✕', className: 'bg-rose-500/20 text-rose-300' };
    case 'needs_input':
      return { label: '!', className: 'bg-amber-500/20 text-amber-300' };
    case 'review':
      return { label: '?', className: 'bg-violet-500/20 text-violet-300' };
    case 'progress':
      return { label: '⋯', className: 'bg-cyan-500/20 text-cyan-300' };
    case 'info':
    default:
      return { label: 'i', className: 'bg-cyan-500/20 text-cyan-300' };
  }
}

export function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return '刚刚';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
```

- [ ] **步骤 3：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/renderer/utils/aiStatus.ts
git commit -m "feat(ai): add aiStatusPill and formatRelativeTime helpers"
```

---

## 任务 10：Dashboard 替换 Training Queue 为 AI Reminders

**文件：**
- 修改：`src/renderer/components/Dashboard/index.tsx`

- [ ] **步骤 1：import Bot 图标与工具函数**

把第 3-7 行的 lucide import：
```ts
import {
  Play, Timer, Brain, Edit,
  GripVertical, Plus, Folder, X, Trash2, CheckCircle2,
  AlertTriangle, Lock, ExternalLink, Bell, AlarmClock
} from 'lucide-react';
```
改为（加 `Bot`）：
```ts
import {
  Play, Timer, Brain, Edit,
  GripVertical, Plus, Folder, X, Trash2, CheckCircle2,
  AlertTriangle, Lock, ExternalLink, Bell, AlarmClock, Bot
} from 'lucide-react';
```

在 `import { useStore } from '../../../store/useStore';`（第 10 行）之后加入：
```ts
import { aiStatusPill, formatRelativeTime } from '../utils/aiStatus';
import type { AiReminder } from '../../../shared/types';
```

- [ ] **步骤 2：从 store 取 aiReminders**

在 `const trainingStatus = useStore(state => state.trainingStatus);`（第 59 行）之后加入：
```ts
  const aiReminders = useStore(state => state.aiReminders);
```

- [ ] **步骤 3：删除已不再使用的 trainingQueue 定义**

删除第 137 行：
```ts
  const trainingQueue = tasks.filter((t:any) => t.type === 'training' && t.status === 'queued');
```
（Region 2 替换后唯一使用点消失。若 lint 报其它使用点，保留并改用 `tasks.filter(...)` 内联。）

- [ ] **步骤 4：替换 Region 2（第 729-758 行整段）**

把：
```tsx
                {/* Region 2: Queued Training */}
                <div className="h-[30%] border-b border-[#1f2937] flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-[#1f2937] bg-[#111827]/50">
                        <h2 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-2">
                           Training Queue
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
                        {trainingQueue.map((t:any) => (
                             ... (原有 Training Queue 渲染) ...
                        ))}
                        {trainingQueue.length === 0 && <div className="text-gray-700 text-[10px] italic text-center mt-4">Empty Queue</div>}
                    </div>
                </div>
```

替换为：
```tsx
                {/* Region 2: AI Reminders (replaced Training Queue) */}
                <div className="h-[30%] border-b border-[#1f2937] flex flex-col overflow-hidden">
                    <div className="p-3 border-b border-cyan-500/20 bg-cyan-500/[0.04]">
                        <h2 className="text-[11px] font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                           <Bot size={14} />
                           AI Reminders
                           {aiReminders.length > 0 && (
                             <span className="ml-auto bg-cyan-500/30 text-cyan-200 px-1.5 rounded text-[9px]">{aiReminders.length}</span>
                           )}
                        </h2>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                        {aiReminders.map((r: AiReminder) => {
                          const pill = aiStatusPill(r.status);
                          return (
                            <div
                              key={r.id}
                              onClick={() => r.link && window.api.openExternal(r.link)}
                              className={clsx(
                                'flex items-center gap-2 rounded px-2 py-1.5 text-xs',
                                r.link && 'cursor-pointer hover:bg-cyan-500/10'
                              )}
                            >
                              <span className={clsx('text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full shrink-0', pill.className)}>
                                {pill.label}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-gray-200 truncate">
                                  <span className="text-cyan-300 font-semibold">{r.source}</span> · {r.title}
                                </div>
                                {r.detail && <div className="text-[10px] text-gray-500 truncate">{r.detail}</div>}
                              </div>
                              <span className="text-[9px] text-gray-600 shrink-0">{formatRelativeTime(r.timestamp)}</span>
                            </div>
                          );
                        })}
                        {aiReminders.length === 0 && (
                          <div className="text-gray-700 text-[10px] italic text-center mt-4">暂无 AI 提醒</div>
                        )}
                    </div>
                </div>
```

注意：`clsx` 已在第 8 行导入。`window.api.openExternal` 由任务 3/4 提供。

- [ ] **步骤 5：运行 lint**

运行：`npm run lint`
预期：PASS（若报 `trainingQueue` 未定义，确认步骤 3 已删除该行；若报其它地方仍引用 `trainingQueue`，按报错处一并清理）

- [ ] **步骤 6：手动验证**

`npm run dev` 起来后运行：
```bash
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d "{\"kind\":\"ai\",\"source\":\"Claude Code\",\"title\":\"构建通过\",\"status\":\"info\",\"detail\":\"main #f3a1\"}"
```
预期：Dashboard 右栏 Region 2 出现青色 AI Reminders 面板，含一条「Claude Code · 构建通过」。不发声音、不弹 Reminder 窗。

- [ ] **步骤 7：Commit**

```bash
git add src/renderer/components/Dashboard/index.tsx
git commit -m "feat(ai): replace Dashboard Training Queue with AI Reminders panel"
```

---

## 任务 11：Spotlight 新增 AI Reminders 卡片

**文件：**
- 修改：`src/renderer/components/Spotlight.tsx`

- [ ] **步骤 1：import Bot 图标**

先确认 Spotlight 已 import 的 lucide 图标集合（在文件顶部 `from 'lucide-react'` 行）。运行：`rg -n "from 'lucide-react'" src/renderer/components/Spotlight.tsx` 查看现有 import。

在该 import 中加入 `Bot`（若无则新增一行 `import { Bot } from 'lucide-react';`）。

- [ ] **步骤 2：import store 选择器与工具函数**

在 Spotlight 顶部 import 区加入：
```ts
import { useStore } from '../store/useStore';  // 若已存在则跳过
import { aiStatusPill, formatRelativeTime } from '../utils/aiStatus';
import type { AiReminder } from '../../shared/types';
```

- [ ] **步骤 3：在组件内取 aiReminders**

在 Spotlight 组件函数内既有 hooks 附近（`const tasks = ...` 一带）加入：
```ts
  const aiReminders = useStore(state => state.aiReminders);
```

- [ ] **步骤 4：在 Soft Reminders 卡片之后插入 AI Reminders 卡片**

定位第 859 行（Soft Reminders 卡片的闭合 `)}`）。在第 859 行之后、第 861 行 `{/* 4. Footer & Hints */}` 之前插入：

```tsx
        {/* 3.6 AI Reminders — card below Soft Reminders */}
        {!selectGpuMode && aiReminders.length > 0 && (
            <div className="mx-4 my-3 rounded-xl border border-cyan-500/40 bg-cyan-500/[0.07] shadow-lg shadow-cyan-500/10 overflow-hidden">
                <div className="px-4 py-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-cyan-300 font-bold border-b border-cyan-500/20 bg-cyan-500/10">
                    <Bot size={11} />
                    AI Reminders
                    <span className="ml-auto bg-cyan-500/30 text-cyan-200 px-1.5 rounded text-[9px]">{aiReminders.length}</span>
                </div>
                <div className="divide-y divide-cyan-500/10">
                    {aiReminders.map((r: AiReminder) => {
                        const pill = aiStatusPill(r.status);
                        return (
                            <div
                                key={r.id}
                                onClick={() => r.link && window.api.openExternal(r.link)}
                                className={`px-4 py-2.5 flex items-center gap-2 group hover:bg-cyan-500/10 transition-colors ${r.link ? 'cursor-pointer' : ''}`}
                            >
                                <span className={`text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full shrink-0 ${pill.className}`}>
                                    {pill.label}
                                </span>
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="text-sm text-cyan-50 truncate">
                                        <span className="text-cyan-300 font-semibold">{r.source}</span> · {r.title}
                                    </span>
                                </div>
                                <span className="text-[9px] text-gray-500 shrink-0">{formatRelativeTime(r.timestamp)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}
```

说明：结构与既有 Soft Reminders 卡片（`Spotlight.tsx:812-859`）对称，仅换 cyan 系与 status pill。空时整卡隐藏（与 Soft Reminders 一致）。

- [ ] **步骤 5：运行 lint**

运行：`npm run lint`
预期：PASS

- [ ] **步骤 6：手动验证**

`npm run dev`，打开 Spotlight（Alt+Space），运行：
```bash
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d "{\"kind\":\"ai\",\"source\":\"Cursor\",\"title\":\"代码审查 pr#142\",\"status\":\"review\"}"
```
预期：Spotlight 在 Soft Reminders（琥珀）下方出现青色 AI Reminders 卡片，含该条。再发一条 `status:success`：
```bash
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d "{\"kind\":\"ai\",\"source\":\"Claude Code\",\"title\":\"构建通过\",\"status\":\"success\",\"link\":\"https://example.com\"}"
```
预期：该条**不**出现在 AI Reminders，而是出现在 Soft Reminders（琥珀，可专注/完成）。

- [ ] **步骤 7：Commit**

```bash
git add src/renderer/components/Spotlight.tsx
git commit -m "feat(ai): add AI Reminders card to Spotlight below Soft Reminders"
```

---

## 任务 12：全量验证

- [ ] **步骤 1：全量 lint**

运行：`npm run lint`
预期：PASS，零 warning/error

- [ ] **步骤 2：验收清单（对照规格第 12 节）**

`npm run dev` 起应用，依次执行并核对：

1. 发 `status:"info"` → Dashboard 青色面板 + Spotlight 青色卡片同时出现；无声、无 Reminder 弹窗 ✓
2. 发 `status:"success"` → Soft Reminders（琥珀）出现可专注/完成项；Dashboard Ad-Hoc 区可见；AI Reminders 无此条 ✓
3. 缺 `source` 或 `title` → HTTP 400 ✓
4. 重启应用 → AI Reminders 清空；success 路由的任务保留 ✓
5. 连发 21 条非完成类 → AI Reminders 仅留最新 20 条 ✓
6. 点带 `link` 的条目 → 系统浏览器打开 ✓
7. 空 AI Reminders → Dashboard 显示「暂无 AI 提醒」；Spotlight 卡片隐藏 ✓

测试用 curl 批量脚本（PowerShell）：
```powershell
1..21 | ForEach-Object {
  $body = @{ kind='ai'; source='Bot'; title="msg $_"; status='info' } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:62222/hook' -ContentType 'application/json' -Body $body
}
```

- [ ] **步骤 3：清理头脑风暴服务（可选）**

若本次会话开过 brainstorm 服务（端口 54027），停止它释放端口：
```powershell
$pidVal = (Get-Content "D:\DevData\DayFlowGemini\.superpowers\brainstorm\ai-reminder-20260620-200038\state\server.pid" | Select-Object -First 1)
Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
```

- [ ] **步骤 4：最终 Commit（若有遗留改动）**

```bash
git add -A
git commit -m "chore(ai): finalize ai soft reminders feature"
```

---

## 自检结果

**规格覆盖度：** 规格第 3 节（webhook 格式）→ 任务 7/8；第 4 节（数据流）→ 任务 5/6/7；第 5 节（类型/store）→ 任务 1/5；第 6 节（IPC）→ 任务 2/3/4；第 7 节（主进程）→ 任务 7/8；第 8 节（UI）→ 任务 9/10/11；第 10 节（错误处理）→ 任务 7（校验抛错）+ 任务 8（400）+ 任务 7（success 失败回退）；第 12 节（验收）→ 任务 12。全部覆盖。

**占位符扫描：** 无 TODO/待定；所有代码步骤含完整代码块。

**类型一致性：** `AiReminder` / `AiReminderStatus`（任务 1 定义）在任务 2、5、6、7、9、10、11 中名称、字段（id/source/title/status/detail/link/timestamp）一致；`handleAiReminder`、`createAiSoftReminder`、`onAiReminder`、`openExternal`、`aiStatusPill`、`formatRelativeTime`、`addAiReminder` 命名前后一致。
