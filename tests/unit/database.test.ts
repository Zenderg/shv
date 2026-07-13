import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDatabase } from '../../src/server/storage/database.js';

describe('openDatabase', () => {
  test('configures a bounded wait for another SQLite writer', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shv-database-'));
    const db = openDatabase(path.join(root, 'db.sqlite'));
    const row = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };

    expect(row.timeout).toBe(5_000);
    db.close();
  });
});
