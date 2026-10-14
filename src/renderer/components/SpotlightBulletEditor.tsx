import { useState, useRef, useEffect, useMemo, KeyboardEvent, MutableRefObject } from 'react';
import { Task, Project, TaskNode } from '../../shared/types';
import { computeBangPriorities } from '../../shared/priority';
import { buildTaskTree, findNode } from '../utils/buildTaskTree';
import { useOutlinerKeyboard, OutlinerActions } from '../hooks/useOutlinerKeyboard';
import { Play, Check, Trash2, MoreHorizontal, ChevronRight, ChevronDown, Send, Target } from 'lucide-react';
import clsx from 'clsx';

// ===== 本地辅助：递归计数后代 =====
const countDescendants = (n: TaskNode): number =>
  n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);

// ===== BulletRow：单行递归组件 =====
interface BulletRowProps {
  node: TaskNode;
  projects: Project[];
  activeNodeId: number | null;
  editingNodeId: number | null;
  collapsed: Set<number>;
  rowRefs: MutableRefObject<Map<number, HTMLInputElement>>;
  onToggleCollapse: (id: number) => void;
  onStartEdit: (id: number) => void;
  onStopEdit: () => void;
  onFocusRow: (id: number | null) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, taskId: number, title: string) => void;
  actions: OutlinerActions;
}

const BulletRow = ({
  node, projects, activeNodeId, editingNodeId, collapsed,
  rowRefs, onToggleCollapse, onStartEdit, onStopEdit, onFocusRow, onKeyDown, actions
}: BulletRowProps) => {
  const { task, children, depth } = node;
  const project = projects.find(p => p.id === task.project_id);
  const projectColor = project?.color || '#64748b';
  const isActive = task.id === activeNodeId;
  const isEditing = task.id === editingNodeId;
  const isFocused = task.status === 'active' && task.timer_type === 'focus';
  const isSideFocus = task.is_side_focus === 1;
  const isCollapsed = collapsed.has(task.id);
  const [title, setTitle] = useState(task.title);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => { if (!isEditing) setTitle(task.title); }, [task.title, isEditing]);

  const commitTitle = () => {
    if (title !== task.title) actions.updateTitle(task.id, title);
    onStopEdit();
  };

  const hasChildren = children.length > 0;

  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <li className="relative">
      <div
        className={clsx(
          "group flex items-center gap-1.5 px-2 py-1.5 transition-colors relative cursor-grab active:cursor-grabbing",
          isActive && "bg-white/5",
          isFocused && "bg-[#10B981]/10"
        )}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
        draggable
        onDragStart={(e) => {
          // Set both dataTransfer (for apps supporting native drop) and clipboard
          // (fallback so user can Ctrl+V in terminals that don't accept drop).
          e.dataTransfer.setData('text/plain', task.title);
          e.dataTransfer.effectAllowed = 'copy';
          // Best-effort clipboard write; ignore failures (e.g. permissions)
          navigator.clipboard?.writeText(task.title).catch(() => {});
        }}
        onDragEnd={() => {
          // Defer to actions.dispatchTask which calls identifyTarget (with built-in
          // delay for foreground window switch) and records to DB.
          actions.dispatchTask(task.id);
        }}
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

        {/* 副 Focus 按钮 */}
        <button
          onClick={() => actions.toggleSideFocus(task.id)}
          className={clsx(
            "shrink-0 transition-all",
            isSideFocus ? "text-[#818CF8]" : "text-[#475569] hover:text-[#818CF8] opacity-0 group-hover:opacity-100"
          )}
          title={isSideFocus ? '取消副 Focus' : '设为副 Focus（最多 2 个）'}
        >
          <Target size={14} />
        </button>

        {/* 项目色点 */}
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: projectColor }}
          title={project?.name || 'Inbox'}
        />

        {/* 标题（原地编辑） */}
        <input
          ref={(el) => { if (el) rowRefs.current.set(task.id, el); else rowRefs.current.delete(task.id); }}
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

        {/* waiting 倒计时占位 */}
        {task.status === 'waiting' && task.target_timestamp && (
          <span className="text-[10px] font-mono text-amber-400 shrink-0">⏳</span>
        )}

        {/* 派发标记：显示最近一次拖拽目标 */}
        {task.dispatched_target && (() => {
          try {
            const info = JSON.parse(task.dispatched_target);
            const time = new Date(info.timestamp);
            const timeStr = `${time.getHours().toString().padStart(2,'0')}:${time.getMinutes().toString().padStart(2,'0')}`;
            return (
              <span
                className="text-[9px] text-cyan-400/80 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded font-mono shrink-0 flex items-center gap-1"
                title={`已派发到 ${info.processName}\n${info.windowTitle || ''}\n${timeStr}`}
              >
                <Send size={9} />
                {info.processName}
              </span>
            );
          } catch { return null; }
        })()}

        {/* 悬停操作 */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
          <button
            onClick={() => actions.completeTask(task.id)}
            className="p-1 text-[#64748b] hover:text-emerald-400"
            title="完成 (Ctrl+Enter)"
          ><Check size={13} /></button>
          <button
            onClick={() => {
              const descCount = countDescendants(node);
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

      {/* 更多菜单 */}
      {showMenu && (
        <div ref={menuRef} className="absolute right-4 mt-1 w-40 bg-[#1E293B] border border-[#334155] rounded-lg shadow-xl z-20 py-1">
          <button onClick={() => { actions.completeTask(task.id); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">完成</button>
          <button onClick={() => { actions.startFocus(task.id); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">设为 Focus</button>
          <button onClick={() => { actions.toggleSideFocus(task.id); setShowMenu(false); }}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5">{isSideFocus ? '取消副 Focus' : '设为副 Focus'}</button>
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

// ===== SpotlightBulletEditor：主组件 =====
interface Props {
  tasks: Task[];
  projects: Project[];
  onRefetch: () => void;
  onExit: () => void;
}

export const SpotlightBulletEditor = ({ tasks, projects, onRefetch, onExit }: Props) => {
  const tree = useMemo(() => {
    const std = tasks.filter(t => t.type !== 'reminder' && t.type !== 'training');
    // Siblings rank by subtree-max bang priority ("!" count) first
    return buildTaskTree(std, computeBangPriorities(std));
  }, [tasks]);

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

  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);
  const [sideFocusNotice, setSideFocusNotice] = useState<string | null>(null);

  // 新任务创建 / 缩进移动后，等树重建完毕再聚焦它的 input。
  // 结构变化会让 input 卸载重挂，不主动恢复焦点的话编辑会中断。
  // 快照守卫：设置标记时 effect 会先在【旧树】上触发一次，此时目标 input
  // 还是旧的（或尚不存在），直接执行会把标记提前清掉——必须等到 tree
  // 引用换成重建后的新树才真正聚焦。
  const pendingFocusTreeRef = useRef<TaskNode[] | null>(null);
  useEffect(() => {
    if (pendingFocusId === null) return;
    if (tree === pendingFocusTreeRef.current) return;
    const el = rowRefs.current.get(pendingFocusId);
    if (el) {
      el.focus();
      setActiveNodeId(pendingFocusId);
      setEditingNodeId(pendingFocusId);
      setPendingFocusId(null);
      pendingFocusTreeRef.current = null;
    }
  }, [pendingFocusId, tree]);

  // 展开 active 节点的祖先链
  useEffect(() => {
    if (activeNodeId === null || collapsed.size === 0) return;
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
  }, [activeNodeId, tree, collapsed]);

  // ===== OutlinerActions 实现 =====
  const actions: OutlinerActions = {
    createChild: async (parentId) => {
      const parent = findNode(tree, parentId);
      const projectId = parent?.task.project_id ?? undefined;
      const newTask = await window.api.createTask('', undefined, 'standard', projectId, parentId, true);
      onRefetch();
      pendingFocusTreeRef.current = tree;
      setPendingFocusId(newTask.id);
    },
    createSibling: async (siblingId) => {
      const sibling = findNode(tree, siblingId);
      const parentId = sibling?.task.parent_id ?? undefined;
      const projectId = sibling?.task.project_id ?? undefined;
      const newTask = await window.api.createTask('', undefined, 'standard', projectId, parentId, true);
      onRefetch();
      pendingFocusTreeRef.current = tree;
      setPendingFocusId(newTask.id);
    },
    updateTitle: async (id, title) => {
      await window.api.updateTask(id, { title });
      onRefetch();
    },
    indent: async (id, title) => {
      const node = findNode(tree, id);
      if (!node) return;
      const parentChildren = node.task.parent_id
        ? (findNode(tree, node.task.parent_id)?.children ?? [])
        : tree;
      const idx = parentChildren.findIndex(n => n.task.id === id);
      if (idx <= 0) return;
      const newParent = parentChildren[idx - 1];
      await window.api.updateTask(id, { title, parent_id: newParent.task.id });
      onRefetch();
      pendingFocusTreeRef.current = tree;
      setPendingFocusId(id);
    },
    dedent: async (id, title) => {
      const node = findNode(tree, id);
      if (!node) return;
      if (!node.task.parent_id) {
        if (title === '') await actions.deleteTask(id);
        return;
      }
      const parent = findNode(tree, node.task.parent_id);
      const newParentId = parent?.task.parent_id ?? null;
      const formerParentId = node.task.parent_id;
      const formerParentSort = parent?.task.sort_order ?? 0;

      const grandparentChildren = parent?.task.parent_id
        ? (findNode(tree, parent.task.parent_id)?.children ?? [])
        : tree;
      const parentIdx = grandparentChildren.findIndex(n => n.task.id === formerParentId);
      const nextSibling = parentIdx >= 0 && parentIdx < grandparentChildren.length - 1
        ? grandparentChildren[parentIdx + 1]
        : null;

      const newSortOrder = nextSibling
        ? Math.floor((formerParentSort + (nextSibling.task.sort_order ?? Date.now())) / 2)
        : formerParentSort + 1;

      await window.api.updateTask(id, { title, parent_id: newParentId, sort_order: newSortOrder });
      onRefetch();
      pendingFocusTreeRef.current = tree;
      setPendingFocusId(id);
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
    toggleSideFocus: async (id) => {
      const node = findNode(tree, id);
      const next = !(node?.task.is_side_focus === 1);
      const ok = await window.api.setSideFocus(id, next);
      if (!ok) {
        setSideFocusNotice('副 Focus 已满（最多 2 个）');
        setTimeout(() => setSideFocusNotice(null), 2000);
        return;
      }
      onRefetch();
    },
    dispatchTask: async (taskId) => {
      // Single IPC handles: 150ms delay → identify target → write to DB →
      // simulate Ctrl+V to paste title (already on clipboard) into target.
      await window.api.dispatchTask(taskId);
      onRefetch();
    },
    moveCursor: (direction) => {
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

  const handleKeyDown = useOutlinerKeyboard({ editingNodeId, actions });

  if (tree.length === 0) return null;

  return (
    <div className="relative flex-1 overflow-y-auto bg-[#0F172A]/50 border-t border-[#334155]/50 custom-scrollbar">
      {sideFocusNotice && (
        <div className="absolute top-9 right-4 z-30 bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs px-3 py-1.5 rounded shadow-lg">
          {sideFocusNotice}
        </div>
      )}
      <div className="px-4 py-2 flex justify-between items-center text-[10px] uppercase tracking-wider text-[#94A3B8] font-bold bg-[#0F172A]/90 backdrop-blur z-10">
        <span>任务树 · Bullet 编辑器</span>
        <span className="bg-[#1E293B] px-1.5 rounded text-white">{tasks.filter(t => t.status !== 'archived').length}</span>
      </div>
      <ul className="py-1">
        {tree.map(node => (
          <BulletRow
            key={node.task.id}
            node={node}
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
