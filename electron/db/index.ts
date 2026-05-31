import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import path from 'path';
import { app } from 'electron';
import { Database as DatabaseType } from './schema';

// Ensure the database file is stored in the user's data directory
export const dbPath = path.join(app.getPath('userData'), 'flowtask.db');

const sqliteDb = new Database(dbPath);

const dialect = new SqliteDialect({
  database: sqliteDb,
});

export const db = new Kysely<DatabaseType>({
  dialect,
});

export async function initDB() {
  // Create Projects Table
  await db.schema
    .createTable('projects')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('color', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  try {
     await db.schema.alterTable('projects').addColumn('color', 'text').execute();
  } catch(e) {}

  // Create Tasks Table (Base)
  await db.schema
    .createTable('tasks')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('context_memo', 'text')
    .addColumn('total_duration', 'integer', (col) => col.defaultTo(0))
    .addColumn('estimated_duration', 'integer')
    .addColumn('tag', 'text')
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  // Naive Migration for v2.6 columns
  try {
     await db.schema.alterTable('tasks').addColumn('type', 'text', col => col.defaultTo('standard')).execute();
  } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('project_id', 'integer').execute();
  } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('parent_id', 'integer').execute();
  } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('is_next_action', 'integer', col => col.defaultTo(0)).execute();
  } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('sort_order', 'integer', col => col.defaultTo(0)).execute();
   } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('gpu_id', 'integer').execute();
  } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('last_focused_at', 'text').execute();
   } catch(e) {}
  try {
     await db.schema.alterTable('tasks').addColumn('is_webhook', 'integer', col => col.defaultTo(0)).execute();
  } catch(e) {}

  // Create GPUs Table
  await db.schema
    .createTable('gpus')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('color', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .addColumn('last_active_at', 'text')
    .execute();

  try {
      await db.schema.alterTable('gpus').addColumn('last_active_at', 'text').execute();
  } catch(e) {}
  try {
      await db.schema.alterTable('gpus').addColumn('host_id', 'text').execute();
  } catch(e) {}


  // Create Tags Table
  await db.schema
    .createTable('tags')
    .ifNotExists()
    .addColumn('name', 'text', (col) => col.primaryKey())
    .addColumn('color', 'text', (col) => col.notNull())
    .execute();

  // Create Timers Table
  await db.schema
    .createTable('timers')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('task_id', 'integer', (col) => col.notNull().references('tasks.id').onDelete('cascade'))
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('target_timestamp', 'text')
    .addColumn('original_duration', 'integer')
    .addColumn('started_at', 'text')
    .execute();

  // Create History Table
  await db.schema
    .createTable('history')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('task_id', 'integer', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('start_time', 'text', (col) => col.notNull())
    .addColumn('end_time', 'text', (col) => col.notNull())
    .execute();

  // Create Settings Table
  await db.schema
    .createTable('settings')
    .ifNotExists()
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'text', (col) => col.notNull())
    .execute();

  // Scheduler Tables (independent from main task system)
  await db.schema
    .createTable('scheduler_gpus')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('color', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('scheduler_tasks')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('estimated_hours', 'real', (col) => col.notNull().defaultTo(1))
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('color', 'text', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  await db.schema
    .createTable('scheduler_assignments')
    .ifNotExists()
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
    .addColumn('task_id', 'integer', (col) => col.notNull())
    .addColumn('gpu_id', 'integer', (col) => col.notNull())
    .addColumn('start_time', 'text', (col) => col.notNull()) // ISO timestamp
    .addColumn('duration_hours', 'real', (col) => col.notNull())
    .addColumn('created_at', 'text', (col) => col.notNull())
    .execute();

  // Migration: rename start_hour to start_time if needed
  try {
    // Check if start_hour column exists (old schema)
    const tableInfo = sqliteDb.pragma('table_info("scheduler_assignments")') as { name: string }[];
    const hasStartHour = tableInfo.some(col => col.name === 'start_hour');
    const hasStartTime = tableInfo.some(col => col.name === 'start_time');
    
    if (hasStartHour && !hasStartTime) {
      console.log('Migrating scheduler_assignments: renaming start_hour to start_time');
      sqliteDb.exec('ALTER TABLE scheduler_assignments RENAME COLUMN start_hour TO start_time');
    }
  } catch (e) {
    console.log('Migration check failed (this is ok for new installs):', e);
  }
  // Try to add start_time column if it doesn't exist (for tables created without it)
  try {
    await db.schema.alterTable('scheduler_assignments').addColumn('start_time', 'text').execute();
  } catch (e) {
    // Column already exists, ignore
  }

  console.log('Database initialized at:', dbPath);
}
