import { Task } from './types';

/**
 * Bang-priority: the number of '!' characters in a task title. Users mark
 * importance by appending them ("任务!!" outranks "任务!" outranks "任务").
 * Pure — recomputed on every render so editing a title re-ranks immediately.
 */
export function countBangs(title: string): number {
  let n = 0;
  for (const ch of title) if (ch === '!') n++;
  return n;
}

/**
 * Effective bang-priority for every task: the maximum bang count within its
 * subtree (itself + all descendants). A parent whose child has "!!" ranks as
 * if the parent itself had "!!". Used for sibling ordering in the task tree,
 * the dashboard queue, and Spotlight suggestions.
 *
 * The overlay deliberately does NOT use this aggregation — its 3 queue slots
 * rank by the task's own bang count only, ignoring parent/child structure.
 */
export function computeBangPriorities(tasks: Task[]): Map<number, number> {
  const childrenOf = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parent_id == null) continue;
    if (!childrenOf.has(t.parent_id)) childrenOf.set(t.parent_id, []);
    childrenOf.get(t.parent_id)!.push(t);
  }

  const memo = new Map<number, number>();
  const visiting = new Set<number>();
  const resolve = (t: Task): number => {
    if (memo.has(t.id)) return memo.get(t.id)!;
    if (visiting.has(t.id)) return 0; // malformed parent cycle — treat as no info
    visiting.add(t.id);
    let best = countBangs(t.title);
    for (const c of childrenOf.get(t.id) ?? []) {
      best = Math.max(best, resolve(c));
    }
    visiting.delete(t.id);
    memo.set(t.id, best);
    return best;
  };

  for (const t of tasks) resolve(t);
  return memo;
}
