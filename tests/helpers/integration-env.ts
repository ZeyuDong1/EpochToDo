/**
 * Shared environment for DB-backed integration tests.
 *
 * The app's `better-sqlite3` native binary is compiled for Electron's ABI,
 * which the system Node used by Vitest cannot load. Instead we substitute a
 * thin adapter over Node's built-in `node:sqlite` that implements exactly
 * the surface kysely's SqliteDriver consumes (see
 * kysely/dist/cjs/dialect/sqlite/sqlite-driver.js):
 *
 *   db.prepare(sql) -> { reader, all(params), run(params), iterate(params) }
 *   db.close()
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const READER_SQL = /^\s*(select|with|values|pragma|explain)\b/i;
/** INSERT/UPDATE/DELETE with a RETURNING clause also produce rows */
const HAS_RETURNING = /\breturning\b/i;

function isReaderStatement(sql: string): boolean {
  return READER_SQL.test(sql) || HAS_RETURNING.test(sql);
}

export class BetterSqlite3Shim {
  #db: DatabaseSync;

  constructor(filePath: string) {
    this.#db = new DatabaseSync(filePath);
  }

  prepare(sql: string) {
    const stmt = this.#db.prepare(sql);
    const reader = isReaderStatement(sql);
    return {
      get reader() {
        return reader;
      },
      all(params: unknown[] = []) {
        return stmt.all(...params);
      },
      run(params: unknown[] = []) {
        const result = stmt.run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      },
      iterate(params: unknown[] = []) {
        return stmt.iterate(...params);
      },
    };
  }

  exec(sql: string) {
    this.#db.exec(sql);
  }

  /** Read-style pragma, e.g. pragma('table_info("tasks")') → row list */
  pragma(source: string) {
    return this.#db.prepare(`PRAGMA ${source}`).all();
  }

  close() {
    this.#db.close();
  }
}

export function makeTempUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'epoch-it-'));
}

export function cleanupTempUserDataDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
