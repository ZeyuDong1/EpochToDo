import { Task } from './types';

/**
 * Ancestor chain of a task, ordered root → immediate parent. Empty when the
 * task is a root or its parents are missing from the list. Used by the
 * overlay to breadcrumb the focus task's position in the tree.
 *
 * Cycle-safe (a malformed parent loop just stops the walk) and depth-capped
 * so a corrupt chain can't grow the breadcrumb unbounded.
 */
export function getAncestorChain(tasks: Task[], taskId: number, maxDepth = 5): Task[] {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const chain: Task[] = [];
  const visited = new Set<number>([taskId]);

  let parent = byId.get(taskId)?.parent_id;
  while (parent != null && chain.length < maxDepth && !visited.has(parent)) {
    const node = byId.get(parent);
    if (!node) break; // parent not in list — stop with the partial chain
    chain.unshift(node);
    visited.add(parent);
    parent = node.parent_id;
  }
  return chain;
}

/**
 * How many breadcrumb levels fit next to the focus title. `levelWidths` is
 * ordered root → parent; inclusion is nearest-first (parent before
 * grandparent) and stops at the first level that doesn't fully fit — a
 * partially truncated ancestor is worse than a hidden one, so levels are
 * all-or-nothing.
 */
export function fitBreadcrumbLevels(
  titleWidth: number,
  levelWidths: number[],
  sepWidth: number,
  availableWidth: number,
): number {
  let used = titleWidth;
  let count = 0;
  for (let i = levelWidths.length - 1; i >= 0; i--) {
    const cost = sepWidth + levelWidths[i];
    if (used + cost > availableWidth) break;
    used += cost;
    count++;
  }
  return count;
}
