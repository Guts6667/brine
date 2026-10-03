import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

// Only the browser-test directory may be reset. Never touch the working database.
const allowedDirectory = path.resolve('test-results/e2e');
const databasePath = path.resolve(process.env.BRINE_DB_PATH ?? '');
if (path.dirname(databasePath) !== allowedDirectory || path.basename(databasePath) !== 'brine.sqlite') {
  throw new Error('La base navigateur doit être test-results/e2e/brine.sqlite.');
}
mkdirSync(allowedDirectory, { recursive: true });
for (const suffix of ['', '-wal', '-shm']) rmSync(databasePath + suffix, { force: true });
