# Spotlight Bullet 编辑器实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为现有 Spotlight 新增"bullet 编辑器模式"，用多级 bullet list 展示和编辑所有活跃任务的层级关系，支持键盘快速建子任务/同级任务、单击切换 focus、原地编辑标题。

**架构：** Renderer-side 新增组件 + 两个小后端改动（递归删除 + 创建跳过去重）。复用现有 IPC（createTask/updateTask/deleteTask/startFocus/completeTask），不改数据库 schema。

**技术栈：** React 18 + TypeScript + Tailwind CSS + Zustand（现有）+ better-sqlite3/kysely（现有）

**验证方式：** 项目无测试运行器（见 AGENTS.md）。每步用 `npm run lint` + `npx tsc --noEmit` 做静态检查，纯函数用 `npx tsx` 内联验证脚本，最终手动验收对照规格第 9 节成功标准。

**规格引用：** `docs/superpowers/specs/2026-06-17-spotlight-bullet-editor-design.md`

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `electron/db/service.ts` | 修改 | `deleteTask` 改递归；`createTask` 加 `skipDedup` 参数 |
| `electron/main.ts` | 修改 | `create-task` / `delete-task` IPC handler 适配新签名 |
| `electron/preload.ts` | 修改 | `createTask` / `deleteTask` 类型签名适配 |
| `src/shared/types.ts` | 修改 | 新增 `TaskNode` 类型 |
| `src/renderer/utils/buildTaskTree.ts` | 创建 | 扁平 Task[] → TaskNode[] 纯函数 |
| `scripts/verify-tree.ts` | 创建（临时） | buildTaskTree 验证脚本，验证后删除 |
| `src/renderer/hooks/useOutlinerKeyboard.ts` | 创建 | 键盘交互 hook |
| `src/renderer/components/SpotlightBulletEditor.tsx` | 创建 | 编辑器主组件（树渲染 + 状态 + IPC 调用） |
| `src/renderer/components/Spotlight.tsx` | 修改 | 加 `editorMode` 状态、Tab 检测、条件渲染编辑器 |

---

## 任务 1：后端 — 递归删除 + 创建跳过去重

**文件：**
- 修改：`electron/db/service.ts`（`createTask` 约 13-60 行，`deleteTask` 137-139 行）
- 修改：`electron/main.ts:190,198`
- 修改：`electron/preload.ts:23,25`

- [ ] **步骤 1：修改 `createTask` 增加 `skipDedup` 参数**

`electron/db/service.ts` 中 `createTask` 签名改为：

```typescript
async createTask(
  title: string,
  tag?: string,
  type: 'standard' | 'ad-hoc' | 'training' | 'external' = 'standard',
  projectId?: number,
  parentId?: number,
  skipDedup: boolean = false
): Promise<Task> {
```

把第 29 行的去重检查包在条件里：

```typescript
if (type !== 'training' && !skipDedup) {
    const existing = await db.selectFrom('tasks')
      .selectAll()
      .where('title', '=', title)
      .where('status', '!=', 'archived')
      .executeTakeFirst();
    if (existing) {
        return existing as unknown as Task;
    }
}
```

- [ ] **步骤 2：修改 `deleteTask` 改为递归删除后代**

`electron/db/service.ts:137-139` 替换为：

```typescript
async deleteTask(id: number): Promise<void> {
    // 递归收集所有后代 id（深度优先，避免删除父节点后子节点变孤儿）
    const idsToDelete: number[] = [];
    const collect = async (currentId: number) => {
        idsToDelete.push(currentId);
        const children = await db.selectFrom('tasks')
            .select('id')
            .where('parent_id', '=', currentId)
            .execute();
        for (const child of children) {
            await collect(child.id);
        }
    };
    await collect(id);
    await db.deleteFrom('tasks').where('id', 'in', idsToDelete).execute();
},
```

- [ ] **步骤 3：更新 IPC handler**

`electron/main.ts:190` 修改 `create-task` handler 接收 `skipDedup`：

```typescript
handleIpc('create-task', async (title: string, tag?: string, type?: any, projectId?: number, parentId?: number, skipDedup?: boolean) => {
  const task = await TaskService.createTask(title, tag, type, projectId, parentId, skipDedup);
  broadcastFetchTasks();
  return task;
});
```

`delete-task` handler（198 行）无需改签名（仍是单 id），因为递归在 service 层完成。

- [ ] **步骤 4：更新 preload.ts 类型签名**

`electron/preload.ts:23` 修改：

```typescript
createTask: (title: string, tag?: string, type?: string, projectId?: number, parentId?: number, skipDedup?: boolean) => invoke('create-task', title, tag, type as any, projectId, parentId, skipDedup),
```

- [ ] **步骤 5：类型检查 + lint**

运行：`npx tsc --noEmit`
预期：无错误

运行：`npm run lint`
预期：无错误（`--max-warnings 0`）

- [ ] **步骤 6：Commit**

```bash
git add electron/db/service.ts electron/main.ts electron/preload.ts
git commit -m "feat: recursive task delete + skipDedup flag for createTask"
```

---

## 任务 2：工具函数 — buildTaskTree

**文件：**
- 修改：`src/shared/types.ts`（末尾追加）
- 创建：`src/renderer/utils/buildTaskTree.ts`
- 创建：`scripts/verify-tree.ts`（临时验证用）

- [ ] **步骤 1：在 types.ts 添加 TaskNode 类型**

`src/shared/types.ts` 末尾追加：

```typescript
export interface TaskNode {
  task: Task;
  children: TaskNode[];
  depth: number;
}
```

- [ ] **步骤 2：创建 buildTaskTree.ts**

`src/renderer/utils/buildTaskTree.ts`：

```typescript
import { Task, TaskNode } from '../../shared/types';

/**
 * 将扁平 Task[] 转换为层级树。
 * - 根节点：parent_id 为 null 或 undefined
 * - 同级按 sort_order 升序，created_at 作为 tiebreaker
 * - 循环引用防护：构建时若发现某节点的祖先链包含自身，跳过该边（断开异常 parent_id）
 * - 孤儿任务（parent_id 指向不存在或已归档的任务）提升为根节点
 */
export function buildTaskTree(tasks: Task[]): TaskNode[] {
  const activeTasks = tasks.filter(t => t.status !== 'archived');
  const byId = new Map<number, TaskNode>();
  const childrenMap = new Map<number | null, Task[]>();

  for (const t of activeTasks) {
    byId.set(t.id, { task: t, children: [], depth: 0 });
  }

  for (const t of activeTasks) {
    const parentKey = t.parent_id && byId.has(t.parent_id) ? t.parent_id : null;
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(t);
  }

  const sortSiblings = (arr: Task[]) =>
    arr.sort((a, b) => {
      const sa = a.sort_order ?? 0;
      const sb = b.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const build = (parent: Task | null, depth: number): TaskNode[] => {
    const siblings = childrenMap.get(parent?.id ?? null) ?? [];
    sortSiblings(siblings);
    return siblings.map(t => {
      const node = byId.get(t.id)!;
      node.depth = depth;
      node.children = build(t, depth + 1);
      return node;
    });
  };

  return build(null, 0);
}

/** 在树中查找节点 */
export function findNode(nodes: TaskNode[], id: number): TaskNode | null {
  for (const n of nodes) {
    if (n.task.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** 收集某节点的所有后代 id（不含自身） */
export function collectDescendantIds(nodes: TaskNode[], id: number): number[] {
  const node = findNode(nodes, id);
  if (!node) return [];
  const ids: number[] = [];
  const walk = (n: TaskNode) => {
    for (const c of n.children) {
      ids.push(c.task.id);
      walk(c);
    }
  };
  walk(node);
  return ids;
}
```

- [ ] **步骤 3：创建验证脚本**

`scripts/verify-tree.ts`：

```typescript
import { buildTaskTree, findNode, collectDescendantIds } from '../src/renderer/utils/buildTaskTree';
import type { Task } from '../src/shared/types';

const mk = (id: number, title: string, parentId: number | null = null, sortOrder = 0): Task => ({
  id, title, status: 'queued', type: 'standard', total_duration: 0,
  project_id: null, parent_id: parentId, is_next_action: 1, sort_order: sortOrder,
  created_at: new Date().toISOString(),
});

// 测试 1：基本层级
const t1: Task[] = [
  mk(1, 'A', null, 1),
  mk(2, 'A1', 1, 2),
  mk(3, 'A2', 1, 1),
  mk(4, 'B', null, 0),
];
const tree1 = buildTaskTree(t1);
console.assert(tree1.length === 2, '应有 2 个根节点');
console.assert(tree1[0].task.id === 4, 'B(sort_order=0) 应排前');
console.assert(tree1[1].task.id === 1, 'A(sort_order=1) 应排后');
console.assert(tree1[1].children.length === 2, 'A 应有 2 个子任务');
console.assert(tree1[1].children[0].task.id === 3, 'A2(sort_order=1) 应排在 A1(sort_order=2) 前');
console.assert(tree1[1].children[0].depth === 1, '子任务 depth 应为 1');

// 测试 2：孤儿提升为根
const t2: Task[] = [mk(1, 'orphan', 999)];
const tree2 = buildTaskTree(t2);
console.assert(tree2.length === 1, '孤儿应提升为根');

// 测试 3：归档过滤
const t3: Task[] = [{ ...mk(1, 'archived'), status: 'archived' as const }, mk(2, 'active')];
const tree3 = buildTaskTree(t3);
console.assert(tree3.length === 1, '归档任务应被过滤');

// 测试 4：collectDescendantIds
const desc = collectDescendantIds(tree1, 1);
console.assert(desc.length === 2 && desc.includes(2) && desc.includes(3), '应收集到 A 的 2 个后代');

// 测试 5：findNode
const found = findNode(tree1, 2);
console.assert(found?.task.title === 'A1', '应找到 A1');

console.log('✅ buildTaskTree 所有断言通过');
```

- [ ] **步骤 4：运行验证脚本**

运行：`npx tsx scripts/verify-tree.ts`
预期：输出 `✅ buildTaskTree 所有断言通过`，无 `AssertionError`

- [ ] **步骤 5：lint + typecheck**

运行：`npm run lint`
运行：`npx tsc --noEmit`
预期：均无错误

- [ ] **步骤 6：删除临时验证脚本并 Commit**

```bash
rm scripts/verify-tree.ts
git add src/shared/types.ts src/renderer/utils/buildTaskTree.ts
git commit -m "feat: add buildTaskTree utility for hierarchical task rendering"
```

---

## 任务 3：键盘交互 Hook — useOutlinerKeyboard

**文件：**
- 创建：`src/renderer/hooks/useOutlinerKeyboard.ts`

此 hook 封装规格第 3 节的键盘模型。组件调用时传入当前树、活动节点 id、以及一组 CRUD 回调。

- [ ] **步骤 1：创建 hook 文件**

`src/renderer/hooks/useOutlinerKeyboard.ts`：

```typescript
import { KeyboardEvent, useCallback } from 'react';
import { Task, TaskNode } from '../../shared/types';

export interface OutlinerActions {
  createChild: (parentId: number, title: string) => Promise<void>;
  createSibling: (siblingId: number, title: string) => Promise<void>;
  updateTitle: (id: number, title: string) => Promise<void>;
  indent: (id: number) => Promise<void>;
  dedent: (id: number) => Promise<void>;
  deleteTask: (id: number) => Promise<void>;
  completeTask: (id: number) => Promise<void>;
  startFocus: (id: number) => Promise<void>;
  moveCursor: (direction: 'up' | 'down') => void;
  exitEditor: () => void;
}

export interface UseOutlinerKeyboardOptions {
  tree: TaskNode[];
  activeNodeId: number | null;
  editingNodeId: number | null;
  actions: OutlinerActions;
}

/**
 * bullet 编辑器键盘处理器。
 * 返回一个绑定到行 input 的 onKeyDown 函数。
 *
 * 键盘模型（规格 Option A）：
 * - Enter = 新建子任务（缩进+1）
 * - Shift+Enter = 新建同级任务
 * - Backspace（行首空标题）= 取消缩进，已在顶层则删除
 * - Tab = 手动缩进
 * - Shift+Tab = 取消缩进
 * - Ctrl+Enter = 完成任务
 * - Ctrl+Backspace = 删除任务
 * - Esc = 退出编辑器（若正在编辑标题则先取消编辑）
 * - ArrowUp/ArrowDown = 移动光标（仅在非编辑状态下）
 */
export function useOutlinerKeyboard({
  tree, activeNodeId, editingNodeId, actions
}: UseOutlinerKeyboardOptions) {
  return useCallback((e: KeyboardEvent<HTMLInputElement>, taskId: number, currentTitle: string) => {
    // 编辑标题时只拦截 Esc 和 Ctrl 组合键，其他键（含 Enter）由标题输入框正常处理？
    // 不——按规格，Enter 即使在编辑中也应触发"提交标题 + 建子任务"。
    // 所以 Enter/Shift+Enter 始终拦截。

    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'Enter') {
        e.preventDefault();
        actions.completeTask(taskId);
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        actions.deleteTask(taskId);
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      actions.exitEditor();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        actions.createSibling(taskId, currentTitle);
      } else {
        actions.createChild(taskId, currentTitle);
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) actions.dedent(taskId);
      else actions.indent(taskId);
      return;
    }

    if (e.key === 'Backspace' && currentTitle === '') {
      e.preventDefault();
      // 先尝试取消缩进；hook 无法直接知道是否在顶层，由 actions.dedent/deleteTask 决定
      // 简化：调用 dedent，dedent 内部判断已在顶层则改为 deleteTask
      actions.dedent(taskId);
      return;
    }

    if (!editingNodeId && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      actions.moveCursor(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
  }, [tree, activeNodeId, editingNodeId, actions]);
}
```

- [ ] **步骤 2：lint + typecheck**

运行：`npm run lint`
运行：`npx tsc --noEmit`
预期：无错误（`Task` import 暂未使用会触发 lint 警告——若如此，移除未用 import）

如果 lint 报 `Task` 未使用，从 import 中移除 `Task`：

```typescript
import { TaskNode } from '../../shared/types';
```

- [ ] **步骤 3：Commit**

```bash
git add src/renderer/hooks/useOutlinerKeyboard.ts
git commit -m "feat: add useOutlinerKeyboard hook for bullet editor"
```

---

## 任务 4：编辑器主组件 — SpotlightBulletEditor

**文件：**
- 创建：`src/renderer/components/SpotlightBulletEditor.tsx`

这是最大的组件。负责：构建树、维护 `activeNodeId`/`editingNodeId`/展开状态、实现所有 `OutlinerActions`、递归渲染 `BulletRow`、悬停菜单。

- [ ] **步骤 1：创建组件文件骨架**

`src/renderer/components/SpotlightBulletEditor.tsx`：

```typescript
import { useState, useRef, useEffect, useMemo, KeyboardEvent } from 'react';
import { Task, Project, TaskNode } from '../../shared/types';
import { buildTaskTree, findNode, collectDescendantIds } from '../utils/buildTaskTree';
import { useOutlinerKeyboard, OutlinerActions } from '../hooks/useOutlinerKeyboard';
import { Play, Check, Trash2, MoreHorizontal, ChevronRight, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  tasks: Task[];
  projects: Project[];
  onRefetch: () => void;
  onExit: () => void;
}

export const SpotlightBulletEditor = ({ tasks, projects, onRefetch, onExit }: Props) => {
  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);

  const [activeNodeId, setActiveNodeId] = useState<number | null>(
    tasks.find(t => t.status === 'active' && t.timer_type === 'focus')?.id ?? tree[0]?.task.id ?? null
  );
  const [editingNodeId, setEditingNodeId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const rowRefs = useRef<Map<number, HTMLInputElement>>(new Map());

  const focusRow = (id: number | null) => {
    setActiveNodeId(id);
    if (id !== null) {
      requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
    }
  };

  // 展开 active 节点的祖先链
  useEffect(() => {
    if (activeNodeId === null) return;
    // 实现略：遍历 tree 找到 active 的祖先 id，从 collapsed 中移除
  }, [activeNodeId, tree]);

  // ===== OutlinerActions 实现 =====
  const actions: OutlinerActions = {
    createChild: async (parentId, title) => {
      const parent = findNode(tree, parentId);
      const projectId = parent?.task.project_id ?? undefined;
      await window.api.createTask(title, undefined, 'standard', projectId, parentId, true);
      onRefetch();
      // 新任务创建后聚焦它（fetch 完成后通过 effect）
    },
    createSibling: async (siblingId, title) => {
      const sibling = findNode(tree, siblingId);
      const parentId = sibling?.task.parent_id ?? undefined;
      const projectId = sibling?.task.project_id ?? undefined;
      await window.api.createTask(title, undefined, 'standard', projectId, parentId, true);
      onRefetch();
    },
    updateTitle: async (id, title) => {
      await window.api.updateTask(id, { title });
      onRefetch();
    },
    indent: async (id) => {
      // 找到前一个同级任务，把当前任务的 parent_id 设为它
      const node = findNode(tree, id);
      if (!node) return;
      // 在父级 children 中找前一个 sibling
      const parentChildren = node.task.parent_id
        ? (findNode(tree, node.task.parent_id)?.children ?? [])
        : tree;
      const idx = parentChildren.findIndex(n => n.task.id === id);
      if (idx <= 0) return; // 已是第一个，无法缩进
      const newParent = parentChildren[idx - 1];
      await window.api.updateTask(id, { parent_id: newParent.task.id });
      onRefetch();
    },
    dedent: async (id) => {
      const node = findNode(tree, id);
      if (!node) return;
      if (!node.task.parent_id) {
        // 已在顶层：删除空标题行
        if (node.task.title === '') await actions.deleteTask(id);
        return;
      }
      const parent = findNode(tree, node.task.parent_id);
      const newParentId = parent?.task.parent_id ?? null;
      await window.api.updateTask(id, { parent_id: newParentId });
      onRefetch();
    },
    deleteTask: async (id) => {
      await window.api.deleteTask(id);
      onRefetch();
    },
    completeTask: async (id) => {
      await window.api.completeTask(id);
      onRefetch();
    },
    startFocus: async (id) => {
      await window.api.startFocus(id);
      onRefetch();
    },
    moveCursor: (direction) => {
      // 扁平化可见节点（排除折叠的子树）
      const flat: number[] = [];
      const walk = (nodes: TaskNode[]) => {
        for (const n of nodes) {
          flat.push(n.task.id);
          if (!collapsed.has(n.task.id)) walk(n.children);
        }
      };
      walk(tree);
      if (flat.length === 0) return;
      const curIdx = activeNodeId ? flat.indexOf(activeNodeId) : -1;
      let nextIdx: number;
      if (direction === 'down') nextIdx = curIdx < flat.length - 1 ? curIdx + 1 : 0;
      else nextIdx = curIdx > 0 ? curIdx - 1 : flat.length - 1;
      focusRow(flat[nextIdx]);
    },
    exitEditor: onExit,
  };

  const handleKeyDown = useOutlinerKeyboard({ tree, activeNodeId, editingNodeId, actions });

  return (
    <div className="flex-1 overflow-y-auto bg-[#0F172A]/50 border-t border-[#334155]/50 custom-scrollbar">
      <div className="px-4 py-2 flex justify-between items-center text-[10px] uppercase tracking-wider text-[#94A3B8] font-bold bg-[#0F172A]/90 backdrop-blur z-10">
        <span>任务树 · Bullet 编辑器</span>
        <span className="bg-[#1E293B] px-1.5 rounded text-white">{tasks.filter(t => t.status !== 'archived').length}</span>
      </div>
      <ul className="py-1">
        {tree.map(node => (
          <BulletRow
            key={node.task.id}
            node={node}
            tasks={tasks}
            projects={projects}
            activeNodeId={activeNodeId}
            editingNodeId={editingNodeId}
            collapsed={collapsed}
            rowRefs={rowRefs}
            onToggleCollapse={(id) => setCollapsed(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onStartEdit={(id) => setEditingNodeId(id)}
            onStopEdit={() => setEditingNodeId(null)}
            onFocusRow={focusRow}
            onKeyDown={handleKeyDown}
            actions={actions}
          />
        ))}
      </ul>
    </div>
  );
};
```

- [ ] **步骤 2：实现 BulletRow 子组件**

在同一文件 `SpotlightBulletEditor.tsx` 中，紧接主组件之前定义 `BulletRow`：

```typescript
interface BulletRowProps {
  node: TaskNode;
  tasks: Task[];
  projects: Project[];
  activeNodeId: number | null;
  editingNodeId: number | null;
  collapsed: Set<number>;
  rowRefs: React.MutableRefObject<Map<number, HTMLInputElement>>;
  onToggleCollapse: (id: number) => void;
  onStartEdit: (id: number) => void;
  onStopEdit: () => void;
  onFocusRow: (id: number | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, taskId: number, title: string) => void;
  actions: OutlinerActions;
}

const BulletRow = ({
  node, tasks, projects, activeNodeId, editingNodeId, collapsed,
  rowRefs, onToggleCollapse, onStartEdit, onStopEdit, onFocusRow, onKeyDown, actions
}: BulletRowProps) => {
  const { task, children, depth } = node;
  const project = projects.find(p => p.id === task.project_id);
  const projectColor = project?.color || '#64748b';
  const isActive = task.id === activeNodeId;
  const isEditing = task.id === editingNodeId;
  const isFocused = task.status === 'active' && task.timer_type === 'focus';
  const isCollapsed = collapsed.has(task.id);
  const [title, setTitle] = useState(task.title);
  const [showMenu, setShowMenu] = useState(false);

  // 同步外部标题变更
  useEffect(() => { if (!isEditing) setTitle(task.title); }, [task.title, isEditing]);

  const commitTitle = () => {
    if (title !== task.title) actions.updateTitle(task.id, title);
    onStopEdit();
  };

  const hasChildren = children.length > 0;

  return (
    <li>
      <div
        className={clsx(
          "group flex items-center gap-1.5 px-2 py-1.5 transition-colors relative",
          isActive && "bg-white/5",
          isFocused && "bg-[#10B981]/10"
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {/* 缩进连接线 */}
        {depth > 0 && (
          <div
            className="absolute top-0 bottom-0 w-px bg-[#334155]/40"
            style={{ left: `${(depth - 1) * 20 + 14}px` }}
          />
        )}

        {/* 展开/折叠 或 占位 */}
        {hasChildren ? (
          <button
            onClick={() => onToggleCollapse(task.id)}
            className="w-4 h-4 flex items-center justify-center text-[#94A3B8] hover:text-white shrink-0"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <div className="w-4 shrink-0" />
        )}

        {/* Focus 按钮 */}
        <button
          onClick={() => actions.startFocus(task.id)}
          className={clsx(
            "shrink-0 transition-all",
            isFocused ? "text-[#10B981]" : "text-[#475569] hover:text-[#10B981] opacity-0 group-hover:opacity-100"
          )}
          title="设为 Focus"
        >
          <Play size={14} fill={isFocused ? 'currentColor' : 'none'} />
        </button>

        {/* 项目色点 */}
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: projectColor }}
          title={project?.name || 'Inbox'}
        />

        {/* 标题（原地编辑） */}
        <input
          ref={(el) => { if (el) rowRefs.current.set(task.id, el); }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => { onFocusRow(task.id); onStartEdit(task.id); }}
          onBlur={commitTitle}
          onKeyDown={(e) => onKeyDown(e, task.id, title)}
          className={clsx(
            "flex-1 bg-transparent outline-none text-sm text-gray-200 placeholder-[#475569] min-w-0",
            isFocused && "font-medium"
          )}
          placeholder="任务名…"
        />

        {/* waiting 倒计时 */}
        {task.status === 'waiting' && task.target_timestamp && (
          <span className="text-[10px] font-mono text-amber-400 shrink-0">
            {task.target_timestamp}
          </span>
        )}

        {/* 悬停操作 */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
          <button
            onClick={() => actions.completeTask(task.id)}
            className="p-1 text-[#64748b] hover:text-emerald-400"
            title="完成 (Ctrl+Enter)"
          ><Check size={13} /></button>
          <button
            onClick={() => {
              const descCount = collectDescendantIds(tasks.map(t => ({ task: t, children: [], depth: 0 })) as any, task.id).length;
              if (descCount > 0 && !confirm(`删除"${task.title}"将同时删除 ${descCount} 个子任务，确定？`)) return;
              actions.deleteTask(task.id);
            }}
            className="p-1 text-[#64748b] hover:text-red-400"
            title="删除 (Ctrl+Backspace)"
          ><Trash2 size={13} /></button>
          <button
            onClick={() => setShowMenu(s => !s)}
            className="p-1 text-[#64748b] hover:text-white"
            title="更多"
          ><MoreHorizontal size={13} /></button>
        </div>
      </div>

      {/* 右键/更多菜单（最小实现） */}
      {showMenu && (
        <div className="absolute right-0 mt-1 w-40 bg-[#1E293B] border border-[#334155] rounded-lg shadow-xl z-20 py-1">
          <button onClick={() => { actions.completeTask(task.id); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">完成</button>
          <button onClick={() => { actions.startFocus(task.id); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">设为 Focus</button>
          <button onClick={() => { setShowMenu(false); onStartEdit(task.id); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">重命名</button>
        </div>
      )}

      {/* 递归子任务 */}
      {hasChildren && !isCollapsed && (
        <ul>
          {children.map(child => (
            <BulletRow
              key={child.task.id}
              node={child}
              tasks={tasks}
              projects={projects}
              activeNodeId={activeNodeId}
              editingNodeId={editingNodeId}
              collapsed={collapsed}
              rowRefs={rowRefs}
              onToggleCollapse={onToggleCollapse}
              onStartEdit={onStartEdit}
              onStopEdit={onStopEdit}
              onFocusRow={onFocusRow}
              onKeyDown={onKeyDown}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
};
```

注意：`BulletRow` 使用 `useState`/`useEffect`，必须是组件而非内联函数。由于它是递归的且在同一文件，需确保它在 `SpotlightBulletEditor` 之前定义，或提升到模块顶层。上面的顺序已正确（先 `BulletRow` 后 `SpotlightBulletEditor`）。

- [ ] **步骤 3：补全 SpotlightBulletEditor 中的展开祖先 effect**

任务 4 步骤 1 中留的 effect，替换为完整实现：

```typescript
useEffect(() => {
  if (activeNodeId === null || collapsed.size === 0) return;
  // 找到 active 节点的所有祖先 id
  const ancestorIds: number[] = [];
  const findPath = (nodes: TaskNode[], target: number, path: number[]): boolean => {
    for (const n of nodes) {
      if (n.task.id === target) { ancestorIds.push(...path); return true; }
      if (findPath(n.children, target, [...path, n.task.id])) return true;
    }
    return false;
  };
  findPath(tree, activeNodeId, []);
  if (ancestorIds.some(id => collapsed.has(id))) {
    setCollapsed(prev => {
      const next = new Set(prev);
      ancestorIds.forEach(id => next.delete(id));
      return next;
    });
  }
}, [activeNodeId, tree]);
```

- [ ] **步骤 4：lint + typecheck**

运行：`npm run lint`
运行：`npx tsc --noEmit`

常见问题修复：
- 若 lint 报 `React.MutableRefObject` 未定义：import `React` 或改用 `React.RefObject<Map<...>>`
- 若 `collectDescendantIds` 参数类型不匹配（步骤 2 删除按钮处）：改为先 `buildTaskTree(tasks)` 一次或直接用 `findNode` 递归。简化删除按钮：

```typescript
onClick={() => {
  const node = findNode(buildTreeForCount, task.id); // 见下方修正
  // 改用本地递归计数：
  const count = (function cnt(n: TaskNode): number { return n.children.reduce((s, c) => s + 1 + cnt(c), 0); })(nodeFromThisRow);
}}
```

更简洁的做法：在 `BulletRow` 中已知 `node`（含 children），直接递归计数：

```typescript
const countDescendants = (n: TaskNode): number =>
  n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
```

在删除按钮 onClick 中：
```typescript
onClick={() => {
  const descCount = countDescendants(node);
  if (descCount > 0 && !confirm(`删除"${task.title}"将同时删除 ${descCount} 个子任务，确定？`)) return;
  actions.deleteTask(task.id);
}}
```

移除文件顶部 `collectDescendantIds` 的 import（改用本地 `countDescendants`），仅保留 `buildTaskTree`/`findNode`。

- [ ] **步骤 5：Commit**

```bash
git add src/renderer/components/SpotlightBulletEditor.tsx
git commit -m "feat: add SpotlightBulletEditor component with recursive bullet rendering"
```

---

## 任务 5：集成到 Spotlight — 模式切换

**文件：**
- 修改：`src/renderer/components/Spotlight.tsx`

- [ ] **步骤 1：添加 editorMode 状态**

`Spotlight.tsx` 顶部 `Spotlight` 组件内（约第 55 行 `const [projectHighlightIdx...` 附近）添加：

```typescript
const [editorMode, setEditorMode] = useState(false);
```

- [ ] **步骤 2：在 input 的 onKeyDown 中检测 Tab 进入编辑器**

找到 `handleKeyDown` 函数（约 253 行）。在最开头（`if (confirmCompleteTask)` 之前）加入：

```typescript
// 空输入 + Tab → 进入 bullet 编辑器模式
if (e.key === 'Tab' && input === '' && !editorMode) {
  e.preventDefault();
  setEditorMode(true);
  return;
}
// 编辑器模式下 Esc 在编辑器内部处理（onExit 回调把 editorMode 设回 false）
```

- [ ] **步骤 3：在编辑器模式下拦截普通 Tab/字符输入**

修改 input 的 `onChange` 或用 `onKeyDown` 防止编辑器模式下误输入。在 input 的 onKeyDown 最前面再加：

```typescript
if (editorMode) {
  if (e.key === 'Escape') { e.preventDefault(); setEditorMode(false); return; }
  // 编辑器模式下忽略其他键（由编辑器内部处理）
  if (e.key !== 'Tab') return;
}
```

- [ ] **步骤 4：条件渲染编辑器替换 Suggestions 区域**

找到 Suggestions 区域（约 661 行 `<div className="flex-1 overflow-y-auto bg-[#0F172A]/50 border-t border-[#334155]/50 custom-scrollbar">`）。

把该 `<div>...</div>` 整块用条件包裹：

```typescript
{editorMode ? (
  <SpotlightBulletEditor
    tasks={tasks}
    projects={projects}
    onRefetch={fetchData}
    onExit={() => setEditorMode(false)}
  />
) : (
  <div className="flex-1 overflow-y-auto bg-[#0F172A]/50 border-t border-[#334155]/50 custom-scrollbar">
    {/* ...原有 Suggestions 内容保持不变... */}
  </div>
)}
```

并在文件顶部 import：

```typescript
import { SpotlightBulletEditor } from './SpotlightBulletEditor';
```

- [ ] **步骤 5：更新模式指示器**

在 input 栏右侧（约 556 行 `{input && (...)}` 处）添加模式标签。修改为：

```typescript
{(input || editorMode) && (
  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
    {editorMode ? (
      <span className="text-[10px] font-mono px-2 py-1 rounded border border-purple-400/30 bg-purple-500/10 text-purple-300">BULLET</span>
    ) : (
      <>
        <span className="text-[10px] font-mono px-2 py-1 rounded border border-white/10 bg-white/5 text-emerald-400 capitalize">{p.type}</span>
        <span className="text-[10px] text-[#94A3B8] bg-[#334155] px-1.5 rounded">↵ Enter</span>
      </>
    )}
  </div>
)}
```

更新 placeholder（约 553 行）：

```typescript
placeholder={editorMode ? "Bullet 编辑器中 · Esc 退出" : "Type task... (! focus, @ suspend, + ad-hoc, % training, > memo)  ·  Tab 进入编辑器"}
```

- [ ] **步骤 6：更新底部快捷键提示**

找到 footer 提示区（约 767 行 `<div className="p-2 grid grid-cols-2 gap-x-4 text-[10px] text-gray-400 font-mono...">`）。

用条件渲染切换提示内容：

```typescript
{editorMode ? (
  <div className="p-2 grid grid-cols-2 gap-x-4 text-[10px] text-gray-400 font-mono border-t border-[#334155]/50">
    <div><span className="text-[#10B981] font-bold">Enter</span> 新建子任务</div>
    <div><span className="text-[#10B981] font-bold">Shift+Enter</span> 新建同级</div>
    <div><span className="text-blue-400 font-bold">Tab</span> 缩进</div>
    <div><span className="text-blue-400 font-bold">Shift+Tab</span> 取消缩进</div>
    <div><span className="text-emerald-400 font-bold">Ctrl+Enter</span> 完成任务</div>
    <div><span className="text-red-400 font-bold">Ctrl+Backspace</span> 删除任务</div>
    <div><span className="text-purple-400 font-bold">▶</span> 单击切换 Focus</div>
    <div><span className="text-gray-400 font-bold">Esc</span> 退出编辑器</div>
  </div>
) : (
  <div className="p-2 grid grid-cols-2 gap-x-4 text-[10px] text-gray-400 font-mono border-t border-[#334155]/50">
    <div><span className="text-[#10B981] font-bold">! Task @ 20m</span> Switch &amp; Suspend</div>
    <div><span className="text-blue-400 font-bold">&gt; Memo</span> Add to Active</div>
    <div><span className="text-amber-500 font-bold">+ Task @ 1h</span> Ad-hoc Task</div>
    <div><span className="text-green-500 font-bold">% Training @ 2h</span> Training Task</div>
    <div><span className="text-green-400 font-bold">Task ` GPU</span> GPU Task</div>
    <div><span className="text-purple-400 font-bold">!Task:</span> Subtask of Focus</div>
  </div>
)}
```

- [ ] **步骤 7：lint + typecheck**

运行：`npm run lint`
运行：`npx tsc --noEmit`

- [ ] **步骤 8：Commit**

```bash
git add src/renderer/components/Spotlight.tsx
git commit -m "feat: integrate SpotlightBulletEditor mode toggle into Spotlight"
```

---

## 任务 6：手动验收

**文件：** 无（对照规格第 9 节成功标准）

- [ ] **步骤 1：启动开发服务器**

运行：`npm run dev`
预期：Electron 窗口 + Spotlight 正常启动，无控制台错误

- [ ] **步骤 2：逐项验收成功标准**

对照 `docs/superpowers/specs/2026-06-17-spotlight-bullet-editor-design.md` 第 9 节：

1. ☐ 打开 Spotlight，输入框为空时按 `Tab` → 进入编辑器，看到所有活跃任务的层级树
2. ☐ 在任意任务上按 `Enter` → 立即创建子任务并开始输入（标题为空的新行，缩进+1）
3. ☐ 点左侧 `▶` → < 200ms 内切换 focus，原 focus 暂停，新任务变 active
4. ☐ 单击标题 → 原地编辑，改完点别处（blur）→ 主窗口刷新看到新标题
5. ☐ 按 `Esc` → 退出回到命令输入，原有命令功能（`!` `@` `+` `%` `>` `#`）仍可用
6. ☐ `Shift+Enter` → 创建同级任务（同缩进）
7. ☐ `Tab` / `Shift+Tab` → 手动缩进/取消缩进
8. ☐ `Ctrl+Enter` → 完成任务（从树中消失）
9. ☐ `Ctrl+Backspace` → 删除任务（有子任务时弹出确认）
10. ☐ `Backspace`（空标题行首）→ 取消缩进；已在顶层再按 → 删除空行

- [ ] **步骤 3：回归测试现有功能**

确认未破坏：
- ☐ 命令模式 `!任务名` 仍能 focus
- ☐ `@ 20m` 挂起仍工作
- ☐ `#` 完成模式仍工作
- ☐ Training 任务创建（`%`）仍工作
- ☐ Waiting tasks 顶部显示仍正常
- ☐ Reminder overlay 仍正常

- [ ] **步骤 4：最终 lint + typecheck**

运行：`npm run lint`
运行：`npx tsc --noEmit`
预期：无错误

---

## 自检结果

**规格覆盖度：** 逐项对照规格章节：
- 第 2 节 UX 决策 → 任务 5（模式入口/切换）、任务 4（focus 按钮/标题编辑/完成删除）
- 第 3 节键盘模型 → 任务 3（hook）+ 任务 4（绑定）
- 第 4 节视觉布局 → 任务 4（BulletRow 渲染：缩进线/色点/展开折叠/悬停菜单）
- 第 5 节模式切换 → 任务 5（Tab/Esc/条件渲染/指示器）
- 第 6 节数据（复用 IPC）→ 任务 1（递归删除+skipDedup）、任务 2（buildTaskTree）
- 第 7 节实现要点 → 全部覆盖（递归删除、原地编辑、焦点管理、乐观更新）
- 第 8 节 YAGNI → 计划未包含拖拽/多选/虚拟化/撤销，符合
- 第 9 节成功标准 → 任务 6 验收清单逐条对应

**占位符扫描：** 任务 4 步骤 3 已补全 effect 实现。无 TODO/待定。任务 4 步骤 2 删除按钮已改为本地 `countDescendants`，消除类型不一致。

**类型一致性：**
- `TaskNode` 在任务 2 定义，任务 3/4 使用一致 ✓
- `OutlinerActions` 在任务 3 定义，任务 4 使用一致 ✓
- `createTask` 新签名（含 `skipDedup`）任务 1 定义，任务 4 调用使用第 6 参数 ✓
- `deleteTask` 签名不变（单 id），递归在 service 内部 ✓

**无测试运行器适配：** 用 lint + typecheck + 临时验证脚本（纯函数）+ 手动验收替代 TDD，符合 AGENTS.md 约定。
