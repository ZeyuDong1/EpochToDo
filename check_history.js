import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

// Electron user data path on Windows is usually %APPDATA%\[app-name]
const userData = path.join(os.homedir(), 'AppData', 'Roaming', 'flow-task', 'flowtask.db');
const db = new Database(userData);

const today = new Date().toISOString().split('T')[0];
const history = db.prepare('SELECT * FROM history WHERE start_time LIKE ?').all(`${today}%`);

console.log('History for today:', JSON.stringify(history, null, 2));

db.close();
