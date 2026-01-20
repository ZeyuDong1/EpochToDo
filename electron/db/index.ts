import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import path from 'path';
import { app } from 'electron';
import { Database as DatabaseType } from './schema';

// Ensure the database file is stored in the user's data directory
export const dbPath = path.join(app.getPath('userData'), 'flowtask.db');

const dialect = new SqliteDialect({
  database: new Database(dbPath),
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

  console.log('Database initialized at:', dbPath);
}
