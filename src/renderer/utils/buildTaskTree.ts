import { Task, TaskNode } from '../../shared/types';

/**
 * 将扁平 Task[] 转换为层级树。
 * - 根节点：parent_id 为 null 或 undefined
 * - 同级按 sort_order 升序，created_at 作为 tiebreaker
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
    const parentKey = t.parent_id !== null && t.parent_id !== undefined && byId.has(t.parent_id) ? t.parent_id : null;
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(t);
  }

  const sortSiblings = (arr: Task[]) =>
    arr.sort((a, b) => {
      const sa = a.sort_order ?? 0;
      const sb = b.sort_order ?? 0;
      if (sa !== sb) return sa - sb;
      return (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0);
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
