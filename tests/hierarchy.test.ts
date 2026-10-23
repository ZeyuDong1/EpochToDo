import { describe, it, expect } from 'vitest';
import { getAncestorChain } from '../src/shared/hierarchy';
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

describe('getAncestorChain', () => {
  it('returns empty for a root task', () => {
    const tasks = [mkTask({ id: 1, title: '根任务' })];
    expect(getAncestorChain(tasks, 1)).toEqual([]);
  });

  it('returns the immediate parent of a subtask', () => {
    const tasks = [
      mkTask({ id: 1, title: '父任务' }),
      mkTask({ id: 2, title: '子任务', parent_id: 1 }),
    ];
    expect(getAncestorChain(tasks, 2).map(t => t.title)).toEqual(['父任务']);
  });

  it('orders the chain root → immediate parent', () => {
    const tasks = [
      mkTask({ id: 1, title: '祖父' }),
      mkTask({ id: 2, title: '父', parent_id: 1 }),
      mkTask({ id: 3, title: '子', parent_id: 2 }),
    ];
    expect(getAncestorChain(tasks, 3).map(t => t.title)).toEqual(['祖父', '父']);
  });

  it('stops at a parent missing from the list', () => {
    const tasks = [
      mkTask({ id: 3, title: '子', parent_id: 2 }),
      mkTask({ id: 2, title: '父', parent_id: 99 }), // 99 doesn't exist
    ];
    expect(getAncestorChain(tasks, 3).map(t => t.title)).toEqual(['父']);
  });

  it('survives a malformed parent cycle', () => {
    const tasks = [
      mkTask({ id: 1, title: 'A', parent_id: 2 }),
      mkTask({ id: 2, title: 'B', parent_id: 1 }),
      mkTask({ id: 3, title: '子', parent_id: 2 }),
    ];
    expect(getAncestorChain(tasks, 3).map(t => t.title)).toEqual(['A', 'B']);
  });

  it('caps the chain depth', () => {
    const tasks: Task[] = [];
    for (let i = 1; i <= 10; i++) {
      tasks.push(mkTask({ id: i, title: `L${i}`, parent_id: i > 1 ? i - 1 : null }));
    }
    expect(getAncestorChain(tasks, 10).map(t => t.id)).toEqual([5, 6, 7, 8, 9]);
  });
});
