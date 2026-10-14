/**
 * Rebuild better-sqlite3 against the installed Electron's Node headers.
 *
 * prebuild-install ships an ABI matching the system Node by default, which
 * Electron's main process cannot load ("NODE_MODULE_VERSION ... mismatch").
 * We invoke prebuild-install directly with electron runtime flags instead of
 * `npm rebuild --runtime=...`, because npm treats those as unknown config and
 * a future npm major may stop forwarding them to install scripts. Tests never
 * load the native module (they mock it with node:sqlite, see
 * tests/helpers/integration-env.ts), so the Electron ABI is the only one the
 * app itself needs.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronVersion = require('electron/package.json').version;
const prebuildInstall = require.resolve('prebuild-install/bin.js');

console.log(`[rebuild-native] better-sqlite3 for electron@${electronVersion}`);
execSync(
  `node "${prebuildInstall}" --runtime electron --target ${electronVersion} --disturl https://artifacts.electronjs.org/headers`,
  { cwd: 'node_modules/better-sqlite3', stdio: 'inherit' },
);
