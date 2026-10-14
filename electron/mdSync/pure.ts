import { createHash } from 'crypto';
import type { Task } from '../../src/shared/types';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/** A single parsed bullet point from an MD file */
export interface ParsedBullet {
  /** zero-based index in the file */
  lineIndex: number;
  /** indentation depth (0 = root, 1 = one level nested, ...) */
  depth: number;
  /** raw text after the bullet marker, trimmed */
  text: string;
  /** whether the bullet is checked `- [x]` style */
  checked: boolean;
  /** content hash for change detection */
  hash: string;
}

/** A bullet plus its nested children, mirroring task hierarchy */
export interface BulletNode {
  bullet: ParsedBullet;
  children: BulletNode[];
}

/* ------------------------------------------------------------------ */
/* Hashing helper                                                     */
/* ------------------------------------------------------------------ */

/** 16-hex-char content hash used to bind a task to an MD line */
export function hashContent(text: string): string {
  return createHash('md5').update(text.trim()).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* MD Parsing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse an MD file's raw text into a list of bullet points.
 * Only checkbox-style bullets (`- [ ]` / `- [x]`) after optional
 * indentation are recognized; plain bullets and other lines are ignored.
 *
 * Indentation rule: every 2 spaces (or 1 tab) = 1 depth level.
 */
export function parseMdContent(content: string): ParsedBullet[] {
  const lines = content.split(/\r?\n/);
  const bullets: ParsedBullet[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: optional leading whitespace, then bullet marker
    const match = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (!match) continue;

    const indent = match[1];
    const text = match[3];

    // Calculate depth: 2 spaces = 1 level, tabs count as 1 level each
    let depth = 0;
    for (const ch of indent) {
      if (ch === '\t') depth += 1;
      else if (ch === ' ') depth += 0.5;
    }
    depth = Math.floor(depth);

    // Only recognize checkbox-style bullets: `- [ ]` or `- [x]`
    // Plain bullets like `- text` are ignored
    const checkMatch = text.match(/^\[( |x|X)\]\s+(.+)$/);
    if (!checkMatch) continue;

    const checked = checkMatch[1].toLowerCase() === 'x';
    const cleanText = checkMatch[2];

    bullets.push({
      lineIndex: i,
      depth,
      text: cleanText.trim(),
      checked,
      hash: hashContent(cleanText),
    });
  }

  return bullets;
}

/**
 * Build a parent-child tree from a flat list of parsed bullets.
 * Returns an array of root-level bullet nodes.
 */
export function buildBulletTree(bullets: ParsedBullet[]): BulletNode[] {
  const roots: BulletNode[] = [];
  const stack: { node: BulletNode; depth: number }[] = [];

  for (const bullet of bullets) {
    const node: BulletNode = { bullet, children: [] };

    // Pop stack until we find a parent with smaller depth
    while (stack.length > 0 && stack[stack.length - 1].depth >= bullet.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, depth: bullet.depth });
  }

  return roots;
}

/* ------------------------------------------------------------------ */
/* MD Generation (Export)                                             */
/* ------------------------------------------------------------------ */

/**
 * Generate MD content from a flat task list, preserving hierarchy.
 * Each standard task becomes a bullet point; children are indented.
 * Archived tasks and empty-title tasks (unsaved drafts) are skipped.
 */
export function generateMdFromTasks(
  tasks: Task[],
  rootParentId: number | null = null
): string {
  // Filter to only standard tasks; skip archived (completed) tasks
  // Archived tasks are NOT written to MD (user controls deletion of [x] lines)
  const standardTasks = tasks.filter(
    (t) =>
      (t.type === 'standard' || t.type === undefined) &&
      t.status !== 'archived' &&
      t.title.trim() !== ''
  );

  // Build children map
  const childrenMap = new Map<number | null, Task[]>();
  for (const t of standardTasks) {
    const pid = t.parent_id ?? null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(t);
  }

  // Sort children by sort_order
  for (const arr of childrenMap.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  const lines: string[] = [];

  function renderTask(task: Task, depth: number): void {
    const indent = '  '.repeat(depth);
    const checkPrefix =
      task.status === 'archived' ? '- [x] ' : '- [ ] ';
    lines.push(`${indent}${checkPrefix}${task.title}`);

    const children = childrenMap.get(task.id) ?? [];
    for (const child of children) {
      renderTask(child, depth + 1);
    }
  }

  const roots = childrenMap.get(rootParentId) ?? [];
  for (const root of roots) {
    renderTask(root, 0);
  }

  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* Task repair (sync: MD → DB)                                        */
/* ------------------------------------------------------------------ */

/** Column updates computed for one task during MD sync */
export interface TaskRepair {
  updates: Partial<Record<string, unknown>>;
  /** set when the MD text differs from the DB title */
  conflict?: { taskId: number; oldTitle: string; newTitle: string };
}

/**
 * Decide which columns of an existing task must be repaired when an
 * unchecked MD bullet matches it. Pure — the caller applies the updates.
 */
export function computeTaskRepairs(
  existing: Task,
  newText: string,
  parentId: number | null,
  activeFocusTaskIds: Set<number>
): TaskRepair {
  const updates: Partial<Record<string, unknown>> = {};
  let conflict: TaskRepair['conflict'];

  if (existing.title !== newText) {
    updates.title = newText;
    conflict = {
      taskId: existing.id,
      oldTitle: existing.title,
      newTitle: newText,
    };
  }
  // Only restore status from 'archived' to 'queued' (Dashboard-visible)
  // Never overwrite 'queued' or other active statuses
  if (existing.status === 'archived') {
    updates.status = 'queued';
  }
  // Fix old default: tasks created before fix had status='active' without a real timer
  if (
    existing.status === 'active' &&
    !activeFocusTaskIds.has(existing.id)
  ) {
    updates.status = 'queued';
  }
  // Ensure is_next_action = 1 for unchecked bullets (fixes old default of 0)
  if (existing.is_next_action !== 1) {
    updates.is_next_action = 1;
  }
  if (existing.parent_id !== parentId) {
    updates.parent_id = parentId;
  }

  return { updates, conflict };
}

/* ------------------------------------------------------------------ */
/* MD merge planning (export: DB → MD)                                */
/* ------------------------------------------------------------------ */

/** Result of pure merge planning; the caller performs all I/O */
export interface MdMergePlan {
  /** full file content to write */
  newContent: string;
  /** number of bullets the file will contain after the merge */
  bulletCount: number;
  /** tasks whose md_file_path / md_line_hash binding must be (re)written */
  rebind: { id: number; hash: string }[];
  /** counts for diagnostic logging */
  diagnostics: { matched: number; orphanChildren: number; newRoot: number };
}

/**
 * Plan how an MD file should be updated from the current task list:
 * update lines for matching tasks, insert orphan children after their
 * parent's subtree, append truly new tasks at the end. Existing [x]
 * lines and unmatched content are preserved.
 *
 * Pure — pass `content = null` when the file does not exist yet.
 */
export function planMdMerge(
  content: string | null,
  tasks: Task[],
  filePath: string
): MdMergePlan {
  const standardTasks = tasks.filter(
    (t) => (t.type === 'standard' || t.type === undefined) && t.title.trim() !== ''
  );

  // File doesn't exist — generate from scratch
  if (content === null) {
    const activeTasks = standardTasks.filter((t) => t.status !== 'archived');
    const newContent = generateMdFromTasks(activeTasks);
    const rebind: { id: number; hash: string }[] = [];
    for (const task of activeTasks) {
      if (task.md_file_path !== filePath || !task.md_line_hash) {
        rebind.push({ id: task.id, hash: hashContent(task.title) });
      }
    }
    // Count ALL bullets including indented children
    const bulletCount = (newContent.match(/^\s*[-*+]\s/gm) || []).length;
    return {
      newContent,
      bulletCount,
      rebind,
      diagnostics: { matched: 0, orphanChildren: 0, newRoot: bulletCount },
    };
  }

  const lines = content.split(/\r?\n/);
  const bullets = parseMdContent(content);

  // Build hash → task map (all standard tasks, including archived)
  const taskByHash = new Map<string, Task>();
  for (const t of standardTasks) {
    const h = hashContent(t.title);
    taskByHash.set(h, t);
  }

  // Track which tasks are already represented in MD
  const matchedTaskIds = new Set<number>();
  // Track matched task → bullet position for child insertion
  const matchedBulletMap = new Map<number, { lineIndex: number; depth: number }>();
  const rebind: { id: number; hash: string }[] = [];

  // Update existing lines
  for (const bullet of bullets) {
    const task = taskByHash.get(bullet.hash);
    if (!task) continue;

    matchedTaskIds.add(task.id);
    matchedBulletMap.set(task.id, { lineIndex: bullet.lineIndex, depth: bullet.depth });
    const shouldBeChecked = task.status === 'archived';
    const line = lines[bullet.lineIndex];

    // Reconstruct line preserving indentation and marker
    const match = line.match(/^(\s*)([-*+])\s/);
    const indent = match ? match[1] : '';
    const marker = match ? match[2] : '-';
    const check = shouldBeChecked ? '[x] ' : '[ ] ';
    lines[bullet.lineIndex] = `${indent}${marker} ${check}${task.title}`;

    // Update hash binding
    if (task.md_line_hash !== bullet.hash || task.md_file_path !== filePath) {
      rebind.push({ id: task.id, hash: bullet.hash });
    }
  }

  // Append active tasks not in MD (respecting parent hierarchy)
  const activeNotInMd = standardTasks.filter(
    (t) => t.status !== 'archived' && !matchedTaskIds.has(t.id)
  );

  // Separate tasks whose parent is already in MD (orphan children)
  // from tasks whose parent is null or also new
  const orphanChildren: Task[] = [];
  const trulyNewTasks: Task[] = [];
  for (const t of activeNotInMd) {
    if (t.parent_id && matchedTaskIds.has(t.parent_id)) {
      orphanChildren.push(t);
    } else {
      trulyNewTasks.push(t);
    }
  }

  // --- Insert orphan children right after their parent's subtree ---
  // Group by parent and sort by sort_order
  const orphansByParent = new Map<number, Task[]>();
  for (const t of orphanChildren) {
    const pid = t.parent_id!;
    if (!orphansByParent.has(pid)) orphansByParent.set(pid, []);
    orphansByParent.get(pid)!.push(t);
  }
  for (const arr of orphansByParent.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  // Build insertion list (process from bottom to top to preserve indices)
  const insertions: { at: number; texts: string[] }[] = [];
  for (const [parentId, children] of orphansByParent) {
    const parentInfo = matchedBulletMap.get(parentId);
    if (!parentInfo) continue;
    const childIndent = '  '.repeat(parentInfo.depth + 1);

    // Find end of parent's subtree: last line with depth > parent's depth
    let insertAfter = parentInfo.lineIndex;
    while (insertAfter + 1 < lines.length) {
      const nextLine = lines[insertAfter + 1];
      const nextMatch = nextLine.match(/^(\s*)([-*+])\s/);
      if (!nextMatch) {
        insertAfter++;
        continue;
      }
      let nextDepth = 0;
      for (const ch of nextMatch[1]) {
        if (ch === '\t') nextDepth += 1;
        else if (ch === ' ') nextDepth += 0.5;
      }
      if (Math.floor(nextDepth) > parentInfo.depth) {
        insertAfter++;
      } else {
        break;
      }
    }

    insertions.push({
      at: insertAfter + 1,
      texts: children.map((t) => `${childIndent}- [ ] ${t.title}`),
    });
  }
  // Apply insertions bottom-to-top
  insertions.sort((a, b) => b.at - a.at);
  for (const ins of insertions) {
    lines.splice(ins.at, 0, ...ins.texts);
  }

  // --- Handle truly new tasks (parent null or also new): tree rendering at end ---
  const childrenMap = new Map<number | null, Task[]>();
  for (const t of trulyNewTasks) {
    const pid = t.parent_id ?? null;
    if (!childrenMap.has(pid)) childrenMap.set(pid, []);
    childrenMap.get(pid)!.push(t);
  }
  for (const arr of childrenMap.values()) {
    arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  const newLines: string[] = [];
  function renderAppend(task: Task, depth: number): void {
    const indent = '  '.repeat(depth);
    newLines.push(`${indent}- [ ] ${task.title}`);
    const children = childrenMap.get(task.id) ?? [];
    for (const child of children) {
      renderAppend(child, depth + 1);
    }
  }

  const rootAppend = childrenMap.get(null) ?? [];
  for (const root of rootAppend) {
    renderAppend(root, 0);
  }

  // Insert truly new lines after the last existing bullet, or at end
  if (newLines.length > 0) {
    let insertAt = lines.length;
    while (insertAt > 0 && lines[insertAt - 1].trim() === '') {
      insertAt--;
    }
    lines.splice(insertAt, 0, ...newLines);
  }

  // Update hash bindings for all appended tasks
  for (const task of activeNotInMd) {
    if (task.md_file_path !== filePath || !task.md_line_hash) {
      rebind.push({ id: task.id, hash: hashContent(task.title) });
    }
  }

  const newContent = lines.join('\n');
  const bulletCount = bullets.length + orphanChildren.length + newLines.length;
  return {
    newContent,
    bulletCount,
    rebind,
    diagnostics: {
      matched: matchedTaskIds.size,
      orphanChildren: orphanChildren.length,
      newRoot: newLines.length,
    },
  };
}

/**
 * Plan moving ONE task's bullet subtree so the MD file reflects an in-app
 * hierarchy change (indent/dedent). planMdMerge rewrites matched lines in
 * place and can never move a line, so without this the watcher's MD→DB merge
 * repairs parent_id back to the file's stale indentation.
 *
 * Surgical by design: only the changed task's subtree — its bullet line plus
 * every following line indented deeper (INCLUDING plain-text notes, which are
 * not bullets and therefore invisible to the parser) — is extracted, re-
 * indented, and re-inserted at the position implied by the DB tree (after the
 * new parent's subtree, or after the previous root sibling's subtree). Every
 * other byte of the file is preserved, so notes under untouched tasks and
 * free-form content never move or disappear.
 */
export interface SubtreeMovePlan {
  newContent: string;
  moved: boolean;
}

export function planSubtreeMove(
  content: string,
  tasks: Task[],
  taskId: number
): SubtreeMovePlan | null {
  const active = tasks.filter(
    (t) =>
      (t.type === 'standard' || t.type === undefined) &&
      t.status !== 'archived' &&
      t.title.trim() !== ''
  );
  const task = active.find((t) => t.id === taskId);
  if (!task) return null;

  const lines = content.split(/\r?\n/);
  const bullets = parseMdContent(content);
  const byHash = new Map(bullets.map((b) => [b.hash, b]));
  const bulletFor = (t: Task): ParsedBullet | undefined =>
    (t.md_line_hash ? byHash.get(t.md_line_hash) : undefined) ??
    byHash.get(hashContent(t.title));

  const bullet = bulletFor(task);
  if (!bullet) return null;

  const lineDepth = (i: number): number | null => {
    const m = lines[i].match(/^(\s*)([-*+])\s/);
    if (!m) return null;
    let d = 0;
    for (const ch of m[1]) {
      if (ch === '\t') d += 1;
      else if (ch === ' ') d += 0.5;
    }
    return Math.floor(d);
  };

  // Subtree span: the bullet line plus every following line that is either a
  // deeper bullet or a non-bullet line (notes) — a bullet at the same or
  // shallower depth ends the subtree.
  const subtreeEnd = (startBullet: ParsedBullet, skipFrom = -1, skipTo = -1): number => {
    let e = startBullet.lineIndex;
    for (let i = startBullet.lineIndex + 1; i < lines.length; i++) {
      if (i >= skipFrom && i <= skipTo) continue;
      const d = lineDepth(i);
      if (d === null || d > startBullet.depth) {
        e = i;
        continue;
      }
      break;
    }
    return e;
  };

  let myEnd = subtreeEnd(bullet);
  // Trailing blank lines are NOT part of the subtree — leave them in place,
  // otherwise re-indenting turns them into whitespace-only residue lines.
  while (myEnd > bullet.lineIndex && lines[myEnd].trim() === '') {
    myEnd--;
  }

  // Desired parent bullet (undefined = root)
  const parentTask = task.parent_id != null ? active.find((t) => t.id === task.parent_id) : undefined;
  const parentBullet = parentTask ? bulletFor(parentTask) : undefined;
  const targetDepth = parentBullet ? parentBullet.depth + 1 : 0;

  // Insertion point in ORIGINAL line numbering: after the anchor line.
  let insertAfter: number;
  if (parentBullet && parentBullet.lineIndex !== bullet.lineIndex) {
    insertAfter = subtreeEnd(parentBullet, bullet.lineIndex, myEnd);
  } else if (!parentBullet) {
    // Root: after the previous root sibling's subtree (by sort_order), else
    // before the next root sibling's bullet, else at the end of the file.
    const roots = active
      .filter((t) => t.parent_id == null)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const myIdx = roots.findIndex((t) => t.id === taskId);
    let anchor: ParsedBullet | undefined;
    let before = false;
    for (let i = myIdx - 1; i >= 0; i--) {
      const b = bulletFor(roots[i]);
      if (b) { anchor = b; break; }
    }
    if (!anchor) {
      for (let i = myIdx + 1; i < roots.length; i++) {
        const b = bulletFor(roots[i]);
        if (b && b.lineIndex !== bullet.lineIndex) { anchor = b; before = true; break; }
      }
    }
    if (!anchor) {
      const last = bullets[bullets.length - 1];
      insertAfter = last && last.lineIndex !== bullet.lineIndex ? subtreeEnd(last, bullet.lineIndex, myEnd) : lines.length - 2;
    } else if (before) {
      insertAfter = anchor.lineIndex - 1;
    } else {
      insertAfter = subtreeEnd(anchor, bullet.lineIndex, myEnd);
    }
  } else {
    // Parent is the task itself or unresolvable — leave in place
    insertAfter = myEnd;
  }

  const delta = targetDepth - bullet.depth;
  if (insertAfter === myEnd && delta === 0) {
    return { newContent: content, moved: false };
  }

  // Extract the span, then correct the insertion index for the removal.
  const span = lines.splice(bullet.lineIndex, myEnd - bullet.lineIndex + 1);
  let insertAt = insertAfter + 1;
  if (insertAfter > myEnd) insertAt -= span.length;

  // Re-indent the span by the level delta, preserving relative depth of each
  // line (notes may sit deeper than the bullet itself).
  const reindented = span.map((l) => {
    if (delta === 0) return l;
    const m = l.match(/^(\s*)(.*)$/s);
    if (!m) return l;
    let d = 0;
    for (const ch of m[1]) {
      if (ch === '\t') d += 1;
      else if (ch === ' ') d += 0.5;
    }
    const rel = Math.max(0, Math.floor(d) - bullet.depth);
    const newDepth = Math.max(0, targetDepth + rel);
    return '  '.repeat(newDepth) + m[2];
  });
  lines.splice(Math.min(insertAt, lines.length), 0, ...reindented);

  return { newContent: lines.join('\n'), moved: true };
}
