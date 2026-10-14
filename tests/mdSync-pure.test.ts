import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import {
  parseMdContent,
  buildBulletTree,
  generateMdFromTasks,
  computeTaskRepairs,
  planMdMerge,
  planSubtreeMove,
  hashContent,
} from '../electron/mdSync/pure';
import type { Task } from '../src/shared/types';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const mkTask = (
  overrides: Partial<Task> & { id: number; title: string }
): Task => ({
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

const FILE = 'C:\\notes\\epochtodo.md';

/* ------------------------------------------------------------------ */
/* parseMdContent                                                      */
/* ------------------------------------------------------------------ */

describe('parseMdContent', () => {
  it('parses checkbox bullets with -, * and + markers', () => {
    const bullets = parseMdContent(
      '- [ ] alpha\n* [x] beta\n+ [ ] gamma\n'
    );
    expect(bullets.map((b) => b.text)).toEqual(['alpha', 'beta', 'gamma']);
    expect(bullets.map((b) => b.checked)).toEqual([false, true, false]);
  });

  it('recognizes uppercase [X] as checked', () => {
    const bullets = parseMdContent('- [X] done\n');
    expect(bullets[0].checked).toBe(true);
  });

  it('ignores plain bullets without a checkbox', () => {
    const bullets = parseMdContent('- plain\n* also plain\nno marker here\n# Heading\n');
    expect(bullets).toHaveLength(0);
  });

  it('computes depth: 2 spaces = 1 level, tab = 1 level, 4 spaces = 2', () => {
    const bullets = parseMdContent(
      '- [ ] root\n  - [ ] child\n\t- [ ] tab-child\n    - [ ] grandchild\n'
    );
    expect(bullets.map((b) => b.depth)).toEqual([0, 1, 1, 2]);
  });

  it('floors fractional depth (3 spaces count as 1 level)', () => {
    const bullets = parseMdContent('- [ ] root\n   - [ ] odd-indent\n');
    expect(bullets[1].depth).toBe(1);
  });

  it('handles CRLF line endings', () => {
    const bullets = parseMdContent('- [ ] a\r\n  - [ ] b\r\n');
    expect(bullets).toHaveLength(2);
    expect(bullets[1].depth).toBe(1);
  });

  it('hashes the trimmed text with md5 (16 hex chars)', () => {
    const bullets = parseMdContent('- [ ]   hello world  \n');
    expect(bullets[0].text).toBe('hello world');
    expect(bullets[0].hash).toBe(hashContent('hello world'));
    expect(bullets[0].hash).toBe(
      createHash('md5').update('hello world').digest('hex').slice(0, 16)
    );
  });

  it('records zero-based line indices', () => {
    const bullets = parseMdContent('# Title\n\n- [ ] a\n  - [ ] b\n');
    expect(bullets.map((b) => b.lineIndex)).toEqual([2, 3]);
  });
});

/* ------------------------------------------------------------------ */
/* buildBulletTree                                                     */
/* ------------------------------------------------------------------ */

describe('buildBulletTree', () => {
  it('nests deeper bullets under their shallower predecessor', () => {
    const bullets = parseMdContent(
      '- [ ] root1\n  - [ ] child1\n    - [ ] grandchild\n  - [ ] child2\n- [ ] root2\n'
    );
    const tree = buildBulletTree(bullets);
    expect(tree).toHaveLength(2);
    expect(tree[0].bullet.text).toBe('root1');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].bullet.text).toBe('child1');
    expect(tree[0].children[0].children[0].bullet.text).toBe('grandchild');
    expect(tree[0].children[1].bullet.text).toBe('child2');
    expect(tree[1].bullet.text).toBe('root2');
  });
});

/* ------------------------------------------------------------------ */
/* generateMdFromTasks                                                 */
/* ------------------------------------------------------------------ */

describe('generateMdFromTasks', () => {
  it('renders hierarchy with 2-space indentation and a trailing newline', () => {
    const md = generateMdFromTasks([
      mkTask({ id: 1, title: 'parent', sort_order: 0 }),
      mkTask({ id: 2, title: 'child', parent_id: 1, sort_order: 0 }),
    ]);
    expect(md).toBe('- [ ] parent\n  - [ ] child\n');
  });

  it('sorts siblings by sort_order regardless of input order', () => {
    const md = generateMdFromTasks([
      mkTask({ id: 2, title: 'second', sort_order: 2 }),
      mkTask({ id: 1, title: 'first', sort_order: 1 }),
    ]);
    expect(md).toBe('- [ ] first\n- [ ] second\n');
  });

  it('excludes archived tasks', () => {
    const md = generateMdFromTasks([
      mkTask({ id: 1, title: 'active' }),
      mkTask({ id: 2, title: 'done', status: 'archived' }),
    ]);
    expect(md).toBe('- [ ] active\n');
  });

  it('excludes empty-title tasks (unsaved drafts)', () => {
    const md = generateMdFromTasks([
      mkTask({ id: 1, title: 'real' }),
      mkTask({ id: 2, title: '   ' }),
      mkTask({ id: 3, title: '' }),
    ]);
    expect(md).toBe('- [ ] real\n');
  });

  it('excludes non-standard task types but includes undefined type', () => {
    const md = generateMdFromTasks([
      mkTask({ id: 1, title: 'std' }),
      mkTask({ id: 2, title: 'notif', type: 'notification' }),
      mkTask({ id: 3, title: 'legacy', type: undefined }),
    ]);
    expect(md).toBe('- [ ] std\n- [ ] legacy\n');
  });
});

/* ------------------------------------------------------------------ */
/* computeTaskRepairs                                                  */
/* ------------------------------------------------------------------ */

describe('computeTaskRepairs', () => {
  it('repairs stale archived status back to queued', () => {
    const { updates } = computeTaskRepairs(
      mkTask({ id: 1, title: 't', status: 'archived' }),
      't',
      null,
      new Set()
    );
    expect(updates.status).toBe('queued');
  });

  it('repairs zombie active status when no focus timer exists', () => {
    const { updates } = computeTaskRepairs(
      mkTask({ id: 1, title: 't', status: 'active' }),
      't',
      null,
      new Set()
    );
    expect(updates.status).toBe('queued');
  });

  it('keeps active status when a real focus timer exists', () => {
    const { updates } = computeTaskRepairs(
      mkTask({ id: 7, title: 't', status: 'active' }),
      't',
      null,
      new Set([7])
    );
    expect(updates.status).toBeUndefined();
  });

  it('flags a title change as a conflict', () => {
    const { updates, conflict } = computeTaskRepairs(
      mkTask({ id: 5, title: 'old' }),
      'new',
      null,
      new Set()
    );
    expect(updates.title).toBe('new');
    expect(conflict).toEqual({ taskId: 5, oldTitle: 'old', newTitle: 'new' });
  });

  it('restores is_next_action and fixes parent drift', () => {
    const { updates } = computeTaskRepairs(
      mkTask({ id: 1, title: 't', is_next_action: 0, parent_id: 2 }),
      't',
      3,
      new Set()
    );
    expect(updates.is_next_action).toBe(1);
    expect(updates.parent_id).toBe(3);
  });

  it('returns no updates for a healthy task', () => {
    const { updates, conflict } = computeTaskRepairs(
      mkTask({ id: 1, title: 't', is_next_action: 1, parent_id: null }),
      't',
      null,
      new Set()
    );
    expect(Object.keys(updates)).toHaveLength(0);
    expect(conflict).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* planMdMerge                                                         */
/* ------------------------------------------------------------------ */

describe('planMdMerge (existing file)', () => {
  it('rewrites matched lines preserving indent and marker', () => {
    const md = '* [ ] stale-title\n';
    const plan = planMdMerge(
      md,
      [mkTask({ id: 1, title: 'stale-title', md_file_path: FILE, md_line_hash: hashContent('stale-title') })],
      FILE
    );
    // title unchanged → line rewritten identically but with '-' default only when marker missing; marker preserved
    expect(plan.newContent).toBe('* [ ] stale-title\n');
    expect(plan.rebind).toHaveLength(0);
  });

  it('marks matched archived tasks as [x]', () => {
    const md = '- [ ] finish report\n';
    const plan = planMdMerge(
      md,
      [mkTask({ id: 1, title: 'finish report', status: 'archived', md_file_path: FILE, md_line_hash: hashContent('finish report') })],
      FILE
    );
    expect(plan.newContent).toBe('- [x] finish report\n');
  });

  it('preserves unmatched MD content verbatim', () => {
    const md = '# Notes\n\n- [ ] random user note\nsome text\n';
    const plan = planMdMerge(md, [], FILE);
    expect(plan.newContent).toBe(md);
  });

  it('appends new root tasks after the last non-blank line', () => {
    const md = '- [ ] existing\n\n\n';
    const plan = planMdMerge(md, [mkTask({ id: 1, title: 'existing', md_file_path: FILE, md_line_hash: hashContent('existing') }), mkTask({ id: 2, title: 'fresh' })], FILE);
    expect(plan.newContent).toBe('- [ ] existing\n- [ ] fresh\n\n\n');
  });

  it('inserts orphan children after the parent subtree, not right after the parent line', () => {
    // Regression (efa4fae): child must land after existing MD children of the parent
    const md = '- [ ] parent\n  - [ ] md-child\n- [ ] other\n';
    const parent = mkTask({ id: 1, title: 'parent', md_file_path: FILE, md_line_hash: hashContent('parent') });
    const mdChild = mkTask({ id: 2, title: 'md-child', parent_id: 1, md_file_path: FILE, md_line_hash: hashContent('md-child') });
    const other = mkTask({ id: 3, title: 'other', md_file_path: FILE, md_line_hash: hashContent('other') });
    const orphan = mkTask({ id: 4, title: 'orphan', parent_id: 1, sort_order: 5 });
    const plan = planMdMerge(md, [parent, mdChild, other, orphan], FILE);
    expect(plan.newContent).toBe(
      '- [ ] parent\n  - [ ] md-child\n  - [ ] orphan\n- [ ] other\n'
    );
    expect(plan.bulletCount).toBe(4);
  });

  it('sorts multiple orphan children by sort_order', () => {
    const md = '- [ ] parent\n';
    const parent = mkTask({ id: 1, title: 'parent', md_file_path: FILE, md_line_hash: hashContent('parent') });
    const b = mkTask({ id: 3, title: 'b-second', parent_id: 1, sort_order: 2 });
    const a = mkTask({ id: 2, title: 'a-first', parent_id: 1, sort_order: 1 });
    const plan = planMdMerge(md, [parent, b, a], FILE);
    // The subtree scan skips the trailing blank line element, so the children
    // land after it — cosmetically identical markdown, locked as current behavior.
    // (join('\n') does not re-add a trailing newline.)
    expect(plan.newContent).toBe('- [ ] parent\n\n  - [ ] a-first\n  - [ ] b-second');
  });

  it('never appends empty-title tasks', () => {
    const md = '- [ ] existing\n';
    const existing = mkTask({ id: 1, title: 'existing', md_file_path: FILE, md_line_hash: hashContent('existing') });
    const draft = mkTask({ id: 2, title: '' });
    const plan = planMdMerge(md, [existing, draft], FILE);
    expect(plan.newContent).toBe(md);
  });

  it('renders a nested tree for a brand-new parent and child', () => {
    const md = '- [ ] existing\n';
    const existing = mkTask({ id: 1, title: 'existing', md_file_path: FILE, md_line_hash: hashContent('existing') });
    const newParent = mkTask({ id: 2, title: 'np' });
    const newChild = mkTask({ id: 3, title: 'nc', parent_id: 2 });
    const plan = planMdMerge(md, [existing, newParent, newChild], FILE);
    expect(plan.newContent).toBe('- [ ] existing\n- [ ] np\n  - [ ] nc\n');
  });

  it('queues a rebind for matched tasks whose binding is stale', () => {
    const md = '- [ ] task\n';
    const task = mkTask({ id: 9, title: 'task' }); // no md binding yet
    const plan = planMdMerge(md, [task], FILE);
    expect(plan.rebind).toEqual([{ id: 9, hash: hashContent('task') }]);

    const bound = mkTask({ id: 9, title: 'task', md_file_path: FILE, md_line_hash: hashContent('task') });
    const planBound = planMdMerge(md, [bound], FILE);
    expect(planBound.rebind).toHaveLength(0);
  });

  it('documents behavior: a DB-side title edit appends a new line and keeps the old one', () => {
    const md = '- [ ] old-title\n';
    const task = mkTask({ id: 1, title: 'renamed-in-db', md_file_path: FILE, md_line_hash: hashContent('old-title') });
    const plan = planMdMerge(md, [task], FILE);
    // hash of the new title no longer matches the MD line → task is treated as new
    expect(plan.newContent).toBe('- [ ] old-title\n- [ ] renamed-in-db\n');
  });
});

describe('planMdMerge (missing file)', () => {
  it('generates active tasks only and queues bindings', () => {
    const plan = planMdMerge(
      null,
      [
        mkTask({ id: 1, title: 'a' }),
        mkTask({ id: 2, title: 'child', parent_id: 1 }),
        mkTask({ id: 3, title: 'done', status: 'archived' }),
        mkTask({ id: 4, title: '' }),
      ],
      FILE
    );
    expect(plan.newContent).toBe('- [ ] a\n  - [ ] child\n');
    expect(plan.rebind).toEqual([
      { id: 1, hash: hashContent('a') },
      { id: 2, hash: hashContent('child') },
    ]);
    expect(plan.bulletCount).toBe(2);
  });

  it('does not rebind tasks that are already correctly bound', () => {
    const bound = mkTask({ id: 1, title: 'a', md_file_path: FILE, md_line_hash: hashContent('a') });
    const plan = planMdMerge(null, [bound], FILE);
    expect(plan.rebind).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* planMdRebuild                                                       */
/* ------------------------------------------------------------------ */

describe('planSubtreeMove', () => {
  it('dedents a child to root in place, carrying its notes along', () => {
    const content = '- [ ] A\n  - [ ] B\n    note-under-B\n- [ ] C\n';
    const tasks = [
      mkTask({ id: 1, title: 'A', sort_order: 0 }),
      mkTask({ id: 2, title: 'B', parent_id: null, sort_order: 1 }),
      mkTask({ id: 3, title: 'C', sort_order: 2 }),
    ];
    const plan = planSubtreeMove(content, tasks, 2);
    expect(plan?.newContent).toBe('- [ ] A\n- [ ] B\n  note-under-B\n- [ ] C\n');
    expect(plan?.moved).toBe(true);
  });

  it('indents a root task under its new parent (position already correct)', () => {
    const content = '- [ ] A\n- [ ] B\n- [ ] C\n';
    const tasks = [
      mkTask({ id: 1, title: 'A', sort_order: 0 }),
      mkTask({ id: 2, title: 'B', parent_id: 1, sort_order: 0 }),
      mkTask({ id: 3, title: 'C', sort_order: 2 }),
    ];
    const plan = planSubtreeMove(content, tasks, 2);
    expect(plan?.newContent).toBe('- [ ] A\n  - [ ] B\n- [ ] C\n');
  });

  it('relocates a task to its sibling position across the file', () => {
    const content = '- [ ] A\n- [ ] C\n- [ ] B\n';
    const tasks = [
      mkTask({ id: 1, title: 'A', sort_order: 0 }),
      mkTask({ id: 2, title: 'B', parent_id: 1, sort_order: 1 }),
      mkTask({ id: 3, title: 'C', sort_order: 2 }),
    ];
    const plan = planSubtreeMove(content, tasks, 2);
    expect(plan?.newContent).toBe('- [ ] A\n  - [ ] B\n- [ ] C\n');
  });

  it('preserves relative depth of notes when relocating', () => {
    const content = '- [ ] A\n- [ ] C\n- [ ] B\n    B-note\n';
    const tasks = [
      mkTask({ id: 1, title: 'A', sort_order: 0 }),
      mkTask({ id: 2, title: 'B', parent_id: 1, sort_order: 1 }),
      mkTask({ id: 3, title: 'C', sort_order: 2 }),
    ];
    const plan = planSubtreeMove(content, tasks, 2);
    expect(plan?.newContent).toBe('- [ ] A\n  - [ ] B\n      B-note\n- [ ] C\n');
  });

  it('leaves other content untouched when dedenting between siblings', () => {
    const content = '# hdr\n- [ ] A\n  - [ ] B\n    b1\n- [ ] C\nfree text\n';
    const tasks = [
      mkTask({ id: 1, title: 'A', sort_order: 0 }),
      mkTask({ id: 2, title: 'B', parent_id: null, sort_order: 1 }),
      mkTask({ id: 3, title: 'C', sort_order: 2 }),
    ];
    const plan = planSubtreeMove(content, tasks, 2);
    expect(plan?.newContent).toBe('# hdr\n- [ ] A\n- [ ] B\n  b1\n- [ ] C\nfree text\n');
  });

  it('returns null for unknown task or missing bullet, and no-ops when in place', () => {
    const content = '- [ ] A\n';
    const tasks = [mkTask({ id: 1, title: 'A' })];
    expect(planSubtreeMove(content, tasks, 99)).toBeNull();
    expect(planSubtreeMove('- [ ] X\n', tasks, 1)).toBeNull();
    const noop = planSubtreeMove(content, tasks, 1);
    expect(noop).toEqual({ newContent: content, moved: false });
  });
});
