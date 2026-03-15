# EpochToDo 统一术语表 (Terminology Glossary)

> 本文档定义项目中所有专有名词的统一叫法，便于后续功能讨论和代码理解。

---

## 一、任务类型 (Task Types)

| 术语 | 英文代码 | 含义 | 用户口语别名 |
|------|----------|------|--------------|
| **标准任务** | `standard` | 常规待办任务，需要专注完成 | "普通任务"、"Focus 任务" |
| **临时任务** | `ad-hoc` | 不属于任何项目的短期事务（如"拿外卖"） | "Ad-hoc"、"生活琐事" |
| **训练任务** | `training` | GPU 训练/长时间后台运行任务 | "GPU 任务"、"Train 任务"、"后台训练" |
| **外部任务** | `external` | 通过 Webhook 创建的任务 | — |

**代码定义**: `src/shared/types.ts` → `TaskType`

**建议统一使用**:
- `Standard Task` / **标准任务**
- `Ad-hoc Task` / **临时任务**
- `Training Task` / **训练任务**

---

## 二、任务状态 (Task Status)

| 术语 | 含义 | 场景 |
|------|------|------|
| `active` | 活跃 | 正在处理或待处理的任务 |
| `waiting` | 等待中 | 被挂起，后台倒计时 |
| `queued` | 已排队 | 在队列中等待执行（训练/临时任务） |
| `archived` | 已归档 | 已完成，历史记录 |

**代码定义**: `src/shared/types.ts` → `TaskStatus`

---

## 三、计时器类型 (Timer Types)

| 术语 | 英文代码 | 含义 | 对应操作 |
|------|----------|------|----------|
| **专注** | `focus` | 正在专心做某事 | `focusSession`, 计时正数 |
| **挂起** | `wait` | 暂停当前任务，设倒计时 | `waitSessions`, 计时倒数 |
| **训练计时** | `training` | GPU 任务运行中 | `trainingStatus` |

**关键区分**:
- `Focus Session` = **当前正在做的事**（只有 1 个）
- `Wait Session` = **挂起等待的事**（可以有多个）
- `Training` = **后台运行的 GPU 任务**

**代码定义**: `src/shared/types.ts` → `TimerType`

---

## 四、会话概念 (Session Concepts)

| 术语 | 数据结构 | 说明 |
|------|----------|------|
| **FocusSession** | `{ taskId, startTime, accumulatedOnStart }` | 当前专注会话，唯一 |
| **WaitSession** | `{ taskId, targetTime, originalDuration }` | 挂起会话，可多个 |
| **TrainingStatus** | `{ taskId, gpuName, modelName, eta, metrics, stalled }` | 训练状态监控 |

**代码定义**: `src/store/useStore.ts`

---

## 五、UI 界面元素 (UI Components)

| 术语 | 含义 | 备注 |
|------|------|------|
| **Spotlight** | 快速启动栏 (`Alt+Space`) | 命令输入入口 |
| **Dashboard** | 主控台/主界面 | 三栏布局 |
| **Timeline** | 左侧时间轴 | 可视化今日专注记录 |
| **Context Panel** | 当前专注卡片 | 显示正在 Focus 的任务 |
| **Pending Grid** | 挂起任务网格 | 显示 Wait 中的任务 |
| **Project Lists / Backlog** | 项目任务列表 | 按项目分组的任务 |
| **Resource Panel** | 右侧资源栏 | GPU 面板和队列 |
| **Overlay** | 持久化浮窗 | 透明悬浮信息层 |
| **Reminder Window** | 提醒窗口 | 倒计时结束弹窗 |

---

## 六、命令语法 (Spotlight Commands)

| 语法 | 动作 | 术语 |
|------|------|------|
| `[任务名]` | 切换并 Focus | **Focus Switch** |
| `![任务名]` | 创建但不 Focus | **Enqueue** |
| `#[任务名]` | 完成任务 | **Complete** |
| `@25m` | 挂起 25 分钟 | **Suspend / Wait** |
| `+任务 @15m` | 创建 Ad-hoc | **Ad-hoc Task** |
| `%模型 @2h` | 创建 Training | **Training Task** |
| `>内容` | 添加备忘 | **Context Memo** |
| `[任务] $[项目]` | 指派项目 | **Assign Project** |
| `[子任务]:` | 创建子任务 | **Child Task** |

---

## 七、沟通规范 (Communication Guidelines)

| 场景 | ✅ 推荐表述 | ❌ 避免混淆 |
|------|------------|------------|
| 切换任务 | "切换 Focus" / "Focus Switch" | "开始任务" |
| 挂起当前 | "Suspend" / "Wait" | "暂停" |
| 创建临时事务 | "Ad-hoc Task" | "临时任务" |
| GPU 相关 | "Training Task" | "训练" / "后台任务" |
| 完成任务 | "Complete" / "Archive" | "关闭" / "结束" |
| 后台倒计时 | "Wait Session" | "等待任务" |

---

## 八、数据模型速查 (Data Model Quick Reference)

```
Task
├── id: number
├── title: string
├── status: TaskStatus ('active' | 'waiting' | 'queued' | 'archived')
├── type: TaskType ('standard' | 'ad-hoc' | 'training' | 'external')
├── project_id: number | null
├── parent_id: number | null      // 子任务关系
├── total_duration: number        // 累计专注秒数
├── estimated_duration: number    // 预估分钟数
├── gpu_id: number | null         // GPU 绑定
├── context_memo: string          // 备忘录
├── timer_type: TimerType         // 当前计时类型
└── ...
```

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-02-24 | 初始版本，整理核心术语 |

---

*此文档由 Agent 维护，随项目演进更新。*
