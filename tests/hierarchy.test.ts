import { describe, it, expect } from 'vitest';
import { getAncestorChain, fitBreadcrumbLevels } from '../src/shared/hierarchy';
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

describe('fitBreadcrumbLevels', () => {
  it('returns 0 when there are no ancestors', () => {
    expect(fitBreadcrumbLevels(100, [], 12, 500)).toBe(0);
  });

  it('shows the parent when title + parent fit', () => {
    expect(fitBreadcrumbLevels(100, [80], 12, 200)).toBe(1);
  });

  it('shows grandparent and parent when everything fits', () => {
    expect(fitBreadcrumbLevels(100, [80, 60], 12, 300)).toBe(2);
  });

  it('stops at the parent when the grandparent would not fully fit', () => {
    // title 100 + sep 12 + parent 80 = 192 ≤ 250; adding sep + grandparent = 264 > 250
    expect(fitBreadcrumbLevels(100, [80, 60], 12, 250)).toBe(1);
  });

  it('hides all ancestors when the title alone fills the width', () => {
    expect(fitBreadcrumbLevels(480, [80, 60], 12, 500)).toBe(0);
  });

  it('never shows a grandparent whose parent does not fit (nearest-first)', () => {
    // parent too wide, grandparent would fit — still nothing
    expect(fitBreadcrumbLevels(100, [30, 300], 12, 200)).toBe(0);
  });

  it('includes a level that fits exactly', () => {
    expect(fitBreadcrumbLevels(100, [88], 12, 200)).toBe(1);
  });
});
