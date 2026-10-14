import fsp from 'fs/promises';
import path from 'path';
import { db } from '../db';
import type { Task, TaskStatus, TaskType } from '../../src/shared/types';
import {
  hashContent,
  parseMdContent,
  buildBulletTree,
  generateMdFromTasks,
  computeTaskRepairs,
  planMdMerge,
  planSubtreeMove,
} from './pure';
import type { ParsedBullet, BulletNode } from './pure';

// Re-export pure helpers (public API kept stable for main.ts / autoSync.ts)
export { parseMdContent, generateMdFromTasks, hashContent } from './pure';
export type { ParsedBullet } from './pure';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

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
  const allTitles = bullets.map((b: ParsedBullet) => b.text);
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
  // Count ALL bullets including indented children
  const bulletCount = (mdContent.match(/^\s*[-*+]\s/gm) || []).length;

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

  // Read existing content (null = file doesn't exist yet)
  let content: string | null = null;
  try {
    content = await fsp.readFile(filePath, 'utf-8');
  } catch {
    // planned as a fresh file below
  }

  const plan = planMdMerge(content, standardTasks, filePath);

  console.error(
    `[mdSync] mergeTasksToMd: total_standard=${standardTasks.length}, matched_in_md=${plan.diagnostics.matched}, to_append=${plan.diagnostics.orphanChildren + plan.diagnostics.newRoot}` +
    standardTasks
      .filter((t) => t.status !== 'archived')
      .map((t) => `\n  ↳ id=${t.id} parent=${t.parent_id} "${t.title}"`)
      .join('')
  );
  if (plan.diagnostics.orphanChildren + plan.diagnostics.newRoot > 0) {
    console.error(
      `[mdSync] mergeTasksToMd: APPENDED ${plan.diagnostics.orphanChildren + plan.diagnostics.newRoot} task(s)`
    );
  }

  // Update hash bindings for matched and appended tasks
  for (const r of plan.rebind) {
    await db
      .updateTable('tasks')
      .set({ md_file_path: filePath, md_line_hash: r.hash })
      .where('id', '=', r.id)
      .execute();
  }

  await fsp.writeFile(filePath, plan.newContent, 'utf-8');

  return { written: true, bulletCount: plan.bulletCount };
}

/**
 * Move one task's bullet subtree in the MD file so it reflects an in-app
 * hierarchy change (indent/dedent). Called after the DB update: the surgical
 * move keeps the task's notes (deeper-indented non-bullet lines) attached to
 * it and leaves every other line untouched. Without this, the watcher's
 * MD→DB merge would repair parent_id back to the file's stale indentation
 * and the hierarchy change would be silently reverted.
 */
export async function moveTaskSubtreeInMd(filePath: string, taskId: number): Promise<void> {
  const allTasks = (await db
    .selectFrom('tasks')
    .selectAll()
    .execute()) as Task[];

  let content: string;
  try {
    content = await fsp.readFile(filePath, 'utf-8');
  } catch {
    return; // no file yet — export will generate it
  }

  const plan = planSubtreeMove(content, allTasks, taskId);
  if (!plan || !plan.moved) return;

  await fsp.writeFile(filePath, plan.newContent, 'utf-8');
  console.error(`[mdSync] moveTaskSubtreeInMd: moved task ${taskId} subtree (${plan.moved})`);
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
      // Unchecked bullet — repair stale columns (title / status / next-action / parent)
      const { updates, conflict } = computeTaskRepairs(
        existing,
        node.bullet.text,
        parentId,
        activeFocusTaskIds
      );
      if (conflict) result.conflicts.push(conflict);

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
