import { app } from 'electron';

/**
 * Optional data-directory override — MUST be imported before anything that
 * touches the database (db/index.ts resolves the SQLite path from
 * app.getPath('userData') at module-load time).
 *
 * Used by the demo/screenshot flow (CAPTURE_SHOTS) to run against a throwaway
 * data dir so published screenshots never contain real user data.
 */
if (process.env.EPOCH_TODO_DATA_DIR) {
  app.setPath('userData', process.env.EPOCH_TODO_DATA_DIR);
}
