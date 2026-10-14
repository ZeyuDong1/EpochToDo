import { describe, it, expect } from 'vitest';
import { countBangs, computeBangPriorities } from '../src/shared/priority';
import { buildTaskTree } from '../src/renderer/utils/buildTaskTree';
import type { Task } from '../src/shared/types';

const mkTask = (overrides: Partial<Task> & { id: number; title: string }): Task => ({
  status: 'queued',
  type: 'standard',
  total_duration: 0,
  project_id: null,
  parent_id: null,
  is_next_action: 1,
  sort_order: 0,
  gpu_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('countBangs', () => {
  it('counts exclamation marks anywhere in the title', () => {
    expect(countBangs('普通任务')).toBe(0);
    expect(countBangs('任务!')).toBe(1);
    expect(countBangs('任务!!')).toBe(2);
    expect(countBangs('紧急!!修复!')).toBe(3);
  });
});

describe('computeBangPriorities', () => {
  it('uses the max bang count within a subtree', () => {
    const tasks = [
      mkTask({ id: 1, title: '父任务' }),
      mkTask({ id: 2, title: '子任务!!', parent_id: 1 }),
      mkTask({ id: 3, title: '孙任务!', parent_id: 2 }),
    ];
    const p = computeBangPriorities(tasks);
    expect(p.get(1)).toBe(2); // inherits the "!!" child
    expect(p.get(2)).toBe(2);
    expect(p.get(3)).toBe(1);
  });

  it('keeps own count when subtree has none higher', () => {
    const tasks = [
      mkTask({ id: 1, title: '父!!' }),
      mkTask({ id: 2, title: '子', parent_id: 1 }),
    ];
    const p = computeBangPriorities(tasks);
    expect(p.get(1)).toBe(2);
    expect(p.get(2)).toBe(0);
  });

  it('does not propagate priority DOWN to children', () => {
    const tasks = [
      mkTask({ id: 1, title: '父!!!' }),
      mkTask({ id: 2, title: '子', parent_id: 1 }),
    ];
    const p = computeBangPriorities(tasks);
    expect(p.get(2)).toBe(0);
  });

  it('survives a malformed parent cycle without hanging', () => {
    const tasks = [
      mkTask({ id: 1, title: 'a!', parent_id: 2 }),
      mkTask({ id: 2, title: 'b', parent_id: 1 }),
    ];
    const p = computeBangPriorities(tasks);
    // Termination + defined values are the contract; cycle members' exact
    // values depend on evaluation order (defensive path only)
    expect(p.get(1)).toBe(1);
    expect(p.has(2)).toBe(true);
  });
});

describe('buildTaskTree with bang priorities', () => {
  it('orders siblings by priority desc, then original sort_order', () => {
    const tasks = [
      mkTask({ id: 1, title: '普通A', sort_order: 0 }),
      mkTask({ id: 2, title: '双叹B!!', sort_order: 1 }),
      mkTask({ id: 3, title: '单叹C!', sort_order: 2 }),
      mkTask({ id: 4, title: '普通D', sort_order: 3 }),
    ];
    const tree = buildTaskTree(tasks, computeBangPriorities(tasks));
    expect(tree.map(n => n.task.id)).toEqual([2, 3, 1, 4]);
  });

  it('ranks a parent via its child\'s priority', () => {
    const tasks = [
      mkTask({ id: 1, title: '无叹父', sort_order: 0 }),
      mkTask({ id: 2, title: '高优子!!!', parent_id: 1 }),
      mkTask({ id: 3, title: '自带!', sort_order: 1 }),
    ];
    const tree = buildTaskTree(tasks, computeBangPriorities(tasks));
    // Parent 1 inherits "!!!" and outranks task 3's single "!"
    expect(tree.map(n => n.task.id)).toEqual([1, 3]);
    expect(tree[0].children.map(n => n.task.id)).toEqual([2]);
  });
});
