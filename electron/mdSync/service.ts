import fsp from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { db } from '../db';
import type { Task, TaskStatus, TaskType } from '../../src/shared/types';

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

/** Result of an import operation */
export interface ImportResult {
  created: number;
  updated: number;
  duplicates: string[]; // titles that already existed
}

/** Result of an export operation */
export interface ExportResult {
  written: boolean;
  bulletCount: number;
}

/* ------------------------------------------------------------------ */
/* Hashing helper                                                     */
/* ------------------------------------------------------------------ */

function hashContent(text: string): string {
  return createHash('md5').update(text.trim()).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* MD Parsing                                                         */
/* ------------------------------------------------------------------ */

/**
 * Parse an MD file's raw text into a list of bullet points.
 * Only lines starting with `- `, `* `, or `+ ` (after indentation)
 * are treated as bullet points.
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
interface BulletNode {
  bullet: ParsedBullet;
  children: BulletNode[];
}

function buildBulletTree(bullets: ParsedBullet[]): BulletNode[] {
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
/* Fixed Filename Helpers                                              */
/* ------------------------------------------------------------------ */

/** Fixed filename used for MD sync inside the selected folder */
export const EPOCHTODO_FILENAME = 'epochtodo.md';

/**
 * Get the full path of the fixed epochtodo.md inside a folder.
 */
export function getEpochtodoPath(folderPath: string): string {
  return path.join(folderPath, EPOCHTODO_FILENAME);
}

/**
 * Check whether epochtodo.md already exists in the given folder.
 * Returns the full path and existence flag.
 */
export async function checkEpochtodoExists(
  folderPath: string
): Promise<{ exists: boolean; filePath: string; bulletCount: number }> {
  const filePath = getEpochtodoPath(folderPath);
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const bullets = parseMdContent(content);
    return { exists: true, filePath, bulletCount: bullets.length };
  } catch {
    return { exists: false, filePath, bulletCount: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Duplicate Detection                                                */
/* ------------------------------------------------------------------ */

/**
 * Check which titles from a list of parsed bullets already exist as
 * standard tasks in the database.
 */
export async function findDuplicateTitles(titles: string[]): Promise<string[]> {
  if (titles.length === 0) return [];
  const existing = await db
    .selectFrom('tasks')
    .select('title')
    .where('type', '=', 'standard' as TaskType)
    .execute();
  const existingSet = new Set(existing.map((r) => r.title));
  return titles.filter((t) => existingSet.has(t));
}

/* ------------------------------------------------------------------ */
/* Import: MD -> Tasks                                                */
/* ------------------------------------------------------------------ */

/**
 * Import bullet points from an MD file into the database as standard tasks.
 * Builds a task tree mirroring the bullet hierarchy.
 *
 * @param filePath  Absolute path to the MD file
 * @param force     If true, create duplicate tasks even if titles exist
 * @param rootParentId  Parent task ID to attach imported tree under (null = root)
 */
export async function importFromMd(
  filePath: string,
  force: boolean,
  rootParentId: number | null = null
): Promise<ImportResult> {
  const content = await fsp.readFile(filePath, 'utf-8');
  const bullets = parseMdContent(content);
  const bulletTree = buildBulletTree(bullets);

  // Collect all titles for duplicate check
  const allTitles = bullets.map((b) => b.text);
  const duplicates = await findDuplicateTitles(allTitles);

  if (duplicates.length > 0 && !force) {
    return { created: 0, updated: 0, duplicates };
  }

  let created = 0;
  const now = new Date().toISOString();

  async function createTaskFromBullet(
    node: BulletNode,
    parentId: number | null
  ): Promise<void> {
    // Skip checked bullets — completed items are not imported
    if (node.bullet.checked) {
      for (const child of node.children) {
        await createTaskFromBullet(child, parentId);
      }
      return;
    }

    // Match TaskService.createTask defaults so MD-created tasks show in Dashboard
    const result = await db
      .insertInto('tasks')
      .values({
        title: node.bullet.text,
        status: 'queued' as TaskStatus,
        type: 'standard' as TaskType,
        parent_id: parentId,
        sort_order: node.bullet.lineIndex,
        created_at: now,
        total_duration: 0,
        is_next_action: 1,
        md_file_path: filePath,
        md_line_hash: node.bullet.hash,
      })
      .executeTakeFirst();

    const taskId = Number(result.insertId);
    created++;

    for (const child of node.children) {
      await createTaskFromBullet(child, taskId);
    }
  }

  // Clear any existing tasks bound to this file at the same root level
  // to avoid duplicates on re-import
  if (force) {
    // Only clear tasks bound to this file that are root-level or under the specified parent
    await db
      .deleteFrom('tasks')
      .where('md_file_path', '=', filePath)
      .execute();
  }

  for (const root of bulletTree) {
    await createTaskFromBullet(root, rootParentId);
  }

  return { created, updated: 0, duplicates: [] };
}

/* ------------------------------------------------------------------ */
/* Export: Tasks -> MD                                                */
/* ------------------------------------------------------------------ */

/**
 * Export a task subtree to an MD file.
 * Fetches all tasks bound to filePath, or all standard tasks if no binding.
 *
 * @param filePath  Target MD file path
 * @param tasks     All tasks to export (will be filtered to standard type)
 */
export async function exportToMd(
  filePath: string,
  tasks: Task[]
): Promise<ExportResult> {
  const mdContent = generateMdFromTasks(tasks);
  const bulletCount = (mdContent.match(/^[-*+]\s/gm) || []).length;

  await fsp.writeFile(filePath, mdContent, 'utf-8');

  // Update md_file_path for all exported tasks
  for (const task of tasks) {
    if (task.type === 'standard' || task.type === undefined) {
      await db
        .updateTable('tasks')
        .set({ md_file_path: filePath })
        .where('id', '=', task.id)
        .execute();
    }
  }

  return { written: true, bulletCount };
}

/**
 * Merge-based export: read existing MD, update lines for matching tasks,
 * append new active tasks. Does NOT remove existing [x] lines or unmatched
 * content. Archived tasks already in MD are updated to [x]; archived tasks
 * NOT in MD are skipped (not written).
 */
export async function mergeTasksToMd(
  filePath: string,
  tasks: Task[]
): Promise<ExportResult> {
  const standardTasks = tasks.filter(
    (t) => (t.type === 'standard' || t.type === undefined) && t.title.trim() !== ''
  );

  // Read existing content
  let content = '';
  try {
    content = await fsp.readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist — use generateMdFromTasks to create from scratch
    const activeTasks = standardTasks.filter((t) => t.status !== 'archived');
    const mdContent = generateMdFromTasks(activeTasks);
    await fsp.writeFile(filePath, mdContent, 'utf-8');
    // Bind all active tasks to this file
    for (const task of activeTasks) {
      if (task.md_file_path !== filePath || !task.md_line_hash) {
        await db
          .updateTable('tasks')
          .set({ md_file_path: filePath, md_line_hash: hashContent(task.title) })
          .where('id', '=', task.id)
          .execute();
      }
    }
    const bulletCount = (mdContent.match(/^[-*+]\s/gm) || []).length;
    return { written: true, bulletCount };
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
      await db
        .updateTable('tasks')
        .set({ md_file_path: filePath, md_line_hash: bullet.hash })
        .where('id', '=', task.id)
        .execute();
    }
  }

  // Append active tasks not in MD (respecting parent hierarchy)
  const activeNotInMd = standardTasks.filter(
    (t) => t.status !== 'archived' && !matchedTaskIds.has(t.id)
  );
  console.error(
    `[mdSync] mergeTasksToMd: total_standard=${standardTasks.length}, matched_in_md=${matchedTaskIds.size}, to_append=${activeNotInMd.length}` +
      activeNotInMd
        .map((t) => `\n  ↳ id=${t.id} parent=${t.parent_id} "${t.title}"`)
        .join('')
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

  const totalAppended = orphanChildren.length + newLines.length;
  if (totalAppended > 0) {
    console.error(
      `[mdSync] mergeTasksToMd: APPENDED ${totalAppended} task(s): orphan_children=${orphanChildren.length} (${orphanChildren
        .map((t) => `"${t.title}"`)
        .join(', ')}), new_root=${newLines.length}`
    );

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
        await db
          .updateTable('tasks')
          .set({ md_file_path: filePath, md_line_hash: hashContent(task.title) })
          .where('id', '=', task.id)
          .execute();
      }
    }
  }

  const newContent = lines.join('\n');
  await fsp.writeFile(filePath, newContent, 'utf-8');

  const bulletCount = bullets.length + newLines.length;
  return { written: true, bulletCount };
}

/* ------------------------------------------------------------------ */
/* Bidirectional Sync                                                 */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  conflicts: { taskId: number; oldTitle: string; newTitle: string }[];
}

/**
 * Perform a bidirectional sync between an MD file and the database.
 *
 * Strategy:
 * 1. Parse the MD file.
 * 2. Fetch all tasks bound to this file from DB.
 * 3. Match by line hash → update titles if changed.
 * 4. New bullets in MD → create tasks.
 * 5. Tasks in DB but not in MD → delete (or mark deleted).
 * 6. Write back the merged content.
 */
export async function syncWithMd(
  filePath: string,
  regenerateMd: boolean = true
): Promise<SyncResult> {
  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    conflicts: [],
  };

  // Read MD file
  let mdContent: string;
  try {
    mdContent = await fsp.readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist → export all bound tasks
    const boundTasks = await db
      .selectFrom('tasks')
      .selectAll()
      .where('md_file_path', '=', filePath)
      .execute() as Task[];

    if (boundTasks.length > 0) {
      await exportToMd(filePath, boundTasks);
    }
    return result;
  }

  const bullets = parseMdContent(mdContent);
  const bulletTree = buildBulletTree(bullets);
  const bulletHashes = new Set(bullets.map((b) => b.hash));

  // Fetch tasks bound to this file
  const dbTasks = (await db
    .selectFrom('tasks')
    .selectAll()
    .where('md_file_path', '=', filePath)
    .execute()) as Task[];

  const taskByHash = new Map<string, Task>();
  for (const t of dbTasks) {
    if (t.md_line_hash) taskByHash.set(t.md_line_hash, t);
  }

  // Fetch task IDs that have an active focus timer (legitimately 'active')
  const activeFocusRows = await db
    .selectFrom('timers')
    .select('task_id')
    .where('type', '=', 'focus')
    .execute();
  const activeFocusTaskIds = new Set(activeFocusRows.map((r) => r.task_id));

  // Phase 1: Update existing tasks (match by hash) or create new ones
  const processedTaskIds = new Set<number>();
  const now = new Date().toISOString();

  async function syncBulletNode(
    node: BulletNode,
    parentId: number | null
  ): Promise<number | null> {
    const existing = node.bullet.hash
      ? taskByHash.get(node.bullet.hash)
      : undefined;

    // Checked bullets: DELETE active tasks (user completed in MD).
    // Archived tasks are left alone (EpochToDo archived them and merge updated MD to [x]).
    // NEVER create new tasks from [x].
    if (node.bullet.checked) {
      if (existing) {
        if (existing.status !== 'archived') {
          // Active task checked in MD → DELETE from DB
          await db.deleteFrom('tasks').where('id', '=', existing.id).execute();
          result.deleted++;
        }
        // If already archived, leave it alone — it was archived by EpochToDo
        // Don't add to processedTaskIds — Phase 2 will clean up if needed
      }
      // No matching task — don't create from [x], still sync children
      for (const child of node.children) {
        await syncBulletNode(child, parentId);
      }
      return null;
    }

    if (existing) {
      // Unchecked bullet — update title, restore from archived if needed
      const updates: Partial<Record<string, unknown>> = {};

      if (existing.title !== node.bullet.text) {
        updates.title = node.bullet.text;
        result.conflicts.push({
          taskId: existing.id,
          oldTitle: existing.title,
          newTitle: node.bullet.text,
        });
      }
      // Only restore status from 'archived' to 'queued' (Dashboard-visible)
      // Never overwrite 'queued' or other active statuses
      if (existing.status === 'archived') {
        updates.status = 'queued' as TaskStatus;
      }
      // Fix old default: tasks created before fix had status='active' without a real timer
      if (
        existing.status === 'active' &&
        !activeFocusTaskIds.has(existing.id)
      ) {
        updates.status = 'queued' as TaskStatus;
      }
      // Ensure is_next_action = 1 for unchecked bullets (fixes old default of 0)
      if (existing.is_next_action !== 1) {
        updates.is_next_action = 1;
      }
      if (existing.parent_id !== parentId) {
        updates.parent_id = parentId;
      }

      if (Object.keys(updates).length > 0) {
        await db
          .updateTable('tasks')
          .set(updates)
          .where('id', '=', existing.id)
          .execute();
        result.updated++;
      }

      processedTaskIds.add(existing.id);

      // Sync children
      for (const child of node.children) {
        await syncBulletNode(child, existing.id);
      }
      return existing.id;
    } else {
      // Create new task (only from unchecked bullets)
      const insertResult = await db
        .insertInto('tasks')
        .values({
          title: node.bullet.text,
          status: 'queued' as TaskStatus,
          type: 'standard' as TaskType,
          parent_id: parentId,
          sort_order: node.bullet.lineIndex,
          created_at: now,
          total_duration: 0,
          is_next_action: 1,
          md_file_path: filePath,
          md_line_hash: node.bullet.hash,
        })
        .executeTakeFirst();

      const newId = Number(insertResult.insertId);
      result.created++;
      processedTaskIds.add(newId);

      for (const child of node.children) {
        await syncBulletNode(child, newId);
      }
      return newId;
    }
  }

  for (const root of bulletTree) {
    await syncBulletNode(root, null);
  }

  // Phase 2: Delete tasks that are no longer in the MD file
  for (const task of dbTasks) {
    // Skip empty-title tasks — they are unsaved drafts (e.g. user pressed
    // Enter to create a new row but hasn't typed yet). Deleting them here
    // would wipe the draft before the user can enter a title.
    if (task.title.trim() === '') continue;

    if (!processedTaskIds.has(task.id)) {
      // Only delete if its hash is not in the MD anymore
      if (task.md_line_hash && !bulletHashes.has(task.md_line_hash)) {
        await db.deleteFrom('tasks').where('id', '=', task.id).execute();
        result.deleted++;
      }
    }
  }

  // Phase 3: Merge DB tasks into MD.
  // Uses mergeTasksToMd which preserves existing [x] lines, updates matching
  // lines, and appends new active tasks. Archived-only tasks are NOT added.
  // SKIPPED when regenerateMd=false (file-watcher sync) to avoid overwriting
  // the user's in-progress edits.
  if (regenerateMd) {
    const allStandardTasks = (await db
      .selectFrom('tasks')
      .selectAll()
      .where((eb) =>
        eb.or([
          eb('type', '=', 'standard' as TaskType),
          eb('type', 'is', null),
        ])
      )
      .execute()) as Task[];

    await mergeTasksToMd(filePath, allStandardTasks);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Write new task to MD file                                          */
/* ------------------------------------------------------------------ */

/**
 * Append a new bullet point to an MD file for a newly created task.
 * Respects parent-child hierarchy by finding the parent's line and
 * appending the child at the correct indentation level.
 */
export async function appendTaskToMd(
  filePath: string,
  task: Task
): Promise<void> {
  // Skip empty-title tasks — they are unsaved drafts
  if (task.title.trim() === '') return;

  let content = '';
  try {
    content = await fsp.readFile(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet, create it
  }

  const lines = content.split(/\r?\n/);

  // Find parent line if task has a parent
  let insertIndex = lines.length;
  let indent = '';

  if (task.parent_id) {
    // Find the parent's line in the file
    const parentTask = (await db
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', task.parent_id)
      .executeTakeFirst()) as Task | undefined;

    if (parentTask && parentTask.md_line_hash) {
      // Find the line whose hash matches the parent
      const bullets = parseMdContent(content);
      const parentBullet = bullets.find(
        (b) => b.hash === parentTask.md_line_hash
      );
      if (parentBullet) {
        insertIndex = parentBullet.lineIndex + 1;
        indent = '  '.repeat(parentBullet.depth + 1);
      }
    }
  }

  const checkPrefix =
    task.status === 'archived' ? '[x] ' : '[ ] ';
  const newLine = `${indent}- ${checkPrefix}${task.title}`;

  // Insert the new line
  lines.splice(insertIndex, 0, newLine);
  await fsp.writeFile(filePath, lines.join('\n'), 'utf-8');

  // Update the task's md_line_hash
  await db
    .updateTable('tasks')
    .set({ md_file_path: filePath, md_line_hash: hashContent(task.title) })
    .where('id', '=', task.id)
    .execute();
}

/**
 * Update a task's title in the bound MD file.
 */
export async function updateTaskInMd(
  filePath: string,
  taskId: number,
  newTitle: string,
  newStatus?: TaskStatus
): Promise<void> {
  const content = await fsp.readFile(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const task = (await db
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirst()) as Task | undefined;

  if (!task || !task.md_line_hash) return;

  const bullets = parseMdContent(content);
  const bullet = bullets.find((b) => b.hash === task.md_line_hash);
  if (!bullet) return;

  const line = lines[bullet.lineIndex];
  const checkPrefix =
    newStatus === 'archived'
      ? '[x] '
      : newStatus === 'active'
        ? '[ ] '
        : bullet.checked
          ? '[x] '
          : '[ ] ';

  // Reconstruct the line preserving indentation and marker
  const match = line.match(/^(\s*)([-*+])\s/);
  const indent = match ? match[1] : '';
  const marker = match ? match[2] : '-';
  lines[bullet.lineIndex] = `${indent}${marker} ${checkPrefix}${newTitle}`;

  await fsp.writeFile(filePath, lines.join('\n'), 'utf-8');

  // Update hash
  await db
    .updateTable('tasks')
    .set({ md_line_hash: hashContent(newTitle) })
    .where('id', '=', taskId)
    .execute();
}

/**
 * Remove a task's bullet point from the bound MD file.
 */
export async function removeTaskFromMd(
  filePath: string,
  taskId: number
): Promise<void> {
  const content = await fsp.readFile(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const task = (await db
    .selectFrom('tasks')
    .selectAll()
    .where('id', '=', taskId)
    .executeTakeFirst()) as Task | undefined;

  if (!task) return;

  const bullets = parseMdContent(content);
  // Try hash first, then fall back to title match
  let bullet = task.md_line_hash
    ? bullets.find((b) => b.hash === task.md_line_hash)
    : undefined;
  if (!bullet) {
    const h = hashContent(task.title);
    bullet = bullets.find((b) => b.hash === h);
  }
  if (!bullet) return;

  lines.splice(bullet.lineIndex, 1);
  await fsp.writeFile(filePath, lines.join('\n'), 'utf-8');
}
