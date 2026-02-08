# 计划：Webhook 与 GPU 显示优化

## 核心摘要 (TL;DR)

> **快速总结**: 增强 Webhook 接口以支持接收详细的训练指标（GPU 名称、进度、ETA 等），并更新前端 UI 以实时可视化这些数据。
> 
> **交付物**:
> - 数据库 Schema 更新（新增进度/元数据字段）
> - 增强的 Webhook 端点（`/hook` 支持 JSON 载荷解析）
> - 更新的前端组件（进度条、ETA 徽章）
> 
> **预估工作量**: 中等 (Medium)
> **并行执行**: 是 - 分 2 波进行
> **关键路径**: DB Schema → 后端服务 → Webhook → 前端 UI

---

## 背景 (Context)

### 原始需求
优化 Webhook 和当前项目里的 GPU 显示，因为通过 Webhook 能传输包括 GPU 名字、训练剩余预估时长等信息。

### 访谈总结
**关键讨论点**:
- **自动创建**: 是，如果系统中不存在指定的 GPU 或任务，则自动创建。
- **持久化**: 是，将训练进度和状态保存到数据库中，以便重启后恢复显示。

**调研发现**:
- 当前 Webhook 功能简单，仅接受 `title` 和 `message`。
- 数据库 `tasks` 表缺乏存储训练进度的字段。
- 前端显示任务列表和 GPU 卡片的组件需要更新以支持新字段。

### 内部审查 (Self-Review)
**识别的差距 (已解决)**:
- **Schema 缺失**: 在 `tasks` 表中增加了 `progress`, `total_epochs`, `current_epoch`, `eta` 等字段。
- **组件定位**: 增加了探索步骤以精确定位 React 组件文件。
- **兼容性**: 确保旧版简单 Webhook 请求仍然兼容。

---

## 工作目标 (Work Objectives)

### 核心目标
通过 Webhook 实现对外部训练任务的富监控，包括进度条、ETA 和 Epoch 信息的可视化。

### 具体交付物
- `electron/db/schema.ts`: 更新 Schema 接口定义
- `electron/main.ts`: 增强 `/hook` 端点逻辑
- `src/renderer/components/TaskItem.tsx` (或类似): UI 更新，增加进度条
- `src/shared/types.ts`: 更新 TypeScript 接口

### 完成定义 (Definition of Done)
- [ ] 使用 `curl` 向 `/hook` 发送 `{ "gpuName": "4090", "progress": 0.5 }` 能立即更新 UI。
- [ ] 任务列表中的训练任务显示进度条。
- [ ] 悬停或查看任务详情时显示 ETA 和 Epoch 信息。
- [ ] 重启应用后，进度数据依然保留。

### 必须包含 (Must Have)
- 自动创建缺失的 GPU/任务。
- 实时 UI 更新（无需刷新）。
- 数据持久化。

### 必须不包含 (Guardrails)
- **阻塞主线程**: 所有 DB 操作必须异步。
- **覆盖用户数据**: 除非明确指定，否则不覆盖用户手动设置的任务标题。

---

## 验证策略 (MANDATORY)

> **通用规则：零人工干预**
>
> 计划中的所有任务必须能够在无人为操作的情况下进行验证。
> 这不是有条件的 —— 它适用于每个任务，无论测试策略如何。
>
> **禁止** — 要求以下内容的验收标准：
> - "用户手动测试..." / "User manually tests..."
> - "用户视觉确认..." / "User visually confirms..."
> - "用户与...交互" / "User interacts with..."
> - "请用户验证..." / "Ask user to verify..."
> - 任何需要人类执行动作的步骤
>
> **所有验证均由 Agent 使用工具（Playwright, interactive_bash, curl 等）执行。无例外。**

### 测试决策
- **基础设施存在**: 否 (标准 Electron/Vite 设置，无配置好的测试运行器)。
- **自动化测试**: 否 (依赖 Agent 执行验证)。
- **Agent 执行 QA**: 总是 (主要方法)。

### Agent 执行 QA 场景 (必须 - 每个任务)

**示例 — API/后端 (curl):**

```
场景: Webhook 更新现有任务进度
  工具: Bash (curl)
  前置条件: 应用运行中，任务 ID 1 存在且类型为 'training'
  步骤:
    1. curl -X POST http://127.0.0.1:62222/hook \
       -H "Content-Type: application/json" \
       -d '{"taskName": "Test Training", "gpuName": "GPU-1", "progress": 0.45, "currentEpoch": 4, "totalEpochs": 10}'
    2. 等待 1秒
    3. 查询 DB: SELECT progress FROM tasks WHERE title="Test Training"
    4. 断言: progress 等于 0.45
  预期结果: 数据库反映新的进度值
  证据: SQL 查询输出
```

**示例 — 前端/UI (Playwright):**

```
场景: 任务卡片显示进度条
  工具: Playwright
  前置条件: 应用运行中，Webhook 已发送进度 0.45
  步骤:
    1. 导航到 Dashboard
    2. 定位 "Test Training" 的任务卡片
    3. 断言: .progress-bar 元素存在
    4. 断言: .progress-bar 宽度约为 45%
    5. 断言: 文本包含 "4/10 Epochs"
  预期结果: UI 视觉上指示进度
  证据: 截图
```

---

## 执行策略 (Execution Strategy)

### 并行执行波次 (Parallel Execution Waves)

```
第 1 波 (立即开始):
├── 任务 1: [数据库 Schema 更新]
└── 任务 4: [前端组件搜索与定位]

第 2 波 (第 1 波完成后):
├── 任务 2: [后端服务与 Webhook 逻辑]
└── 任务 5: [前端组件实现]

第 3 波 (第 2 波完成后):
└── 任务 3: [验证与清理]

关键路径: 任务 1 → 任务 2 → 任务 5
并行加速比: ~30%
```

---

## 待办事项 (TODOs)

- [ ] 1. [数据库 Schema 更新]

  **要做什么**:
  - 修改 `electron/db/schema.ts`，向 `TaskTable` 接口添加新字段：
    - `progress`: number (0-1 或 0-100)
    - `current_epoch`: number
    - `total_epochs`: number
    - `eta`: number (剩余秒数)
    - `training_status`: string ('training', 'paused', 'finished', 'error')
    - `last_updated`: string (ISO 时间戳)
  - 修改 `electron/db/index.ts` 中的 `initDB` 函数，添加 SQL 语句以在表存在时添加这些列（如果列不存在）。
    - 使用 `PRAGMA table_info(tasks)` 检查列是否存在，或者使用 `ALTER TABLE ADD COLUMN` 并捕获错误。

  **绝对不要做**:
  - 删除现有数据。
  - 使用破坏性的迁移（如 DROP TABLE）。

  **推荐 Agent 配置**:
  - **类别**: `quick`
  - **技能**: [`git-master`]

  **并行化**:
  - **可以并行运行**: 是
  - **并行组**: 第 1 波
  - **阻塞**: 任务 2
  - **被阻塞**: 无

  **参考资料**:
  - `electron/db/schema.ts` - 当前 Schema 定义
  - `electron/db/index.ts` - DB 初始化逻辑

  **验收标准**:
  - [ ] Schema 文件包含 `TaskTable` 接口的新字段。
  - [ ] 应用启动无 DB 错误。
  - [ ] `sqlite3 electron/db/data.db "PRAGMA table_info(tasks)"` 显示新列。

---

- [ ] 2. [后端服务与 Webhook 逻辑]

  **要做什么**:
  - 更新 `electron/db/service.ts` 中的 `TaskService`:
    - 添加 `updateTrainingProgress(taskId, data)` 方法，用于更新进度、Epoch 和 ETA。
    - 添加 `findTaskByGpuAndName(gpuName, taskName)` 辅助方法。
  - 更新 `electron/main.ts` 中的 `/hook` 处理程序:
    - 解析新的 JSON 载荷字段 (`gpuName`, `progress`, `eta` 等)。
    - 实现逻辑:
      1. 根据 `gpuName` 查找或创建 GPU (使用 `GpuService`)。
      2. 查找链接到该 GPU 的任务，或创建新任务 (如果 `taskName` 提供)。
      3. 调用 `updateTrainingProgress` 更新数据。
      4. 广播 `fetch-tasks` 事件通知前端刷新。

  **绝对不要做**:
  - 移除对旧版 Webhook 格式（仅 `title` 和 `message`）的支持，必须保留作为回退。

  **推荐 Agent 配置**:
  - **类别**: `deep`
  - **技能**: [`git-master`]

  **并行化**:
  - **可以并行运行**: 否
  - **并行组**: 第 2 波
  - **阻塞**: 任务 3
  - **被阻塞**: 任务 1

  **参考资料**:
  - `electron/main.ts:343` - 当前 Webhook 处理程序
  - `electron/db/service.ts` - TaskService 实现

  **验收标准**:
  - [ ] POST /hook 发送 `{ "gpuName": "A100", "taskName": "LLM Train", "progress": 0.1 }` 返回 200 OK。
  - [ ] 数据库查询显示任务 "LLM Train" 已创建，且 gpu_id 链接到 "A100"。
  - [ ] 数据库查询显示 progress=0.1。

---

- [ ] 3. [共享类型定义更新]

  **要做什么**:
  - 更新 `src/shared/types.ts` (或 `Task` 接口定义的任何位置)，确保前端和后端共用相同的类型定义。
  - 添加 `progress`, `current_epoch`, `total_epochs`, `eta` 到 `Task` 接口。

  **推荐 Agent 配置**:
  - **类别**: `quick`
  - **技能**: [`git-master`]

  **并行化**:
  - **可以并行运行**: 是
  - **并行组**: 第 2 波
  - **阻塞**: 任务 5
  - **被阻塞**: 无

  **参考资料**:
  - `src/shared/types.ts` (如果路径不同，需先搜索确认)

  **验收标准**:
  - [ ] `Task` 接口包含新属性。
  - [ ] `electron` 和 `src/renderer` 代码中无 TypeScript 类型错误。

---

- [ ] 4. [前端组件搜索与定位]

  **要做什么**:
  - 使用 `grep` 或 `find` 查找渲染任务列表的 React 组件 (关键词: `TaskItem`, `Card`, `.map`).
  - 确定 GPU 状态/卡片的渲染位置。
  - 记录确切的文件路径，供任务 5 使用。

  **推荐 Agent 配置**:
  - **类别**: `explore`
  - **技能**: [`git-master`]

  **并行化**:
  - **可以并行运行**: 是
  - **并行组**: 第 1 波
  - **阻塞**: 任务 5
  - **被阻塞**: 无

  **参考资料**:
  - `src/renderer` 目录

  **验收标准**:
  - [ ] 识别出 Task Item 和 GPU Card 的文件路径。

---

- [ ] 5. [前端组件实现]

  **要做什么**:
  - 更新任务组件 (由任务 4 定位):
    - 如果 `task.type === 'training'` 或 `progress` 字段有值:
      - 渲染进度条 (使用 `<progress>` 标签或 Tailwind 样式的 div)。
      - 显示 "Epoch X/Y" (如果有)。
      - 显示 "ETA: Z min" (如果有)。
  - 更新 GPU 卡片 (如适用) 以显示状态颜色 (绿色=活跃, 黄色=空闲)。

  **推荐 Agent 配置**:
  - **类别**: `visual-engineering`
  - **技能**: [`frontend-ui-ux`, `git-master`]

  **并行化**:
  - **可以并行运行**: 否
  - **并行组**: 第 2 波
  - **阻塞**: 任务 3
  - **被阻塞**: 任务 3, 任务 4

  **参考资料**:
  - (任务 4 的输出结果)

  **验收标准**:
  - [ ] 发送 Webhook 更新后，UI 中的进度条发生变化。
  - [ ] Epoch 文本正确显示。
  - [ ] UI 样式整洁，符合现有的 Tailwind 设计风格。

---

## 成功标准 (Success Criteria)

### 验证命令
```bash
# 测试完整流程
curl -X POST http://127.0.0.1:62222/hook -H "Content-Type: application/json" -d '{"title": "Test Task", "gpuName": "RTX 4090", "progress": 50, "totalEpochs": 100, "currentEpoch": 50}'
```

### 最终检查清单
- [ ] 数据库 Schema 更新安全，不丢失数据。
- [ ] Webhook 同时支持旧版 (简单) 和新版 (富数据) 载荷。
- [ ] UI 正确渲染训练任务的进度条。
- [ ] 标准任务的行为无回归。
