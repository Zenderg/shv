import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import { applyMigrations } from '../../src/server/storage/migrations.js';
import { openDatabase, type Db } from '../../src/server/storage/database.js';

class MigrationDbStub {
  execStatements: string[] = [];

  exec(sql: string) {
    this.execStatements.push(sql);

    if (sql === 'BEGIN') {
      throw new Error('begin failed');
    }

    if (sql === 'ROLLBACK') {
      throw new Error('rollback without transaction');
    }
  }

  prepare(sql: string) {
    if (sql === 'SELECT id FROM schema_migrations') {
      return {
        all: () => []
      };
    }

    return {
      run: () => undefined
    };
  }
}

describe('applyMigrations', () => {
  test('preserves the original error when a migration transaction fails to begin', () => {
    const db = new MigrationDbStub();

    expect(() => applyMigrations(db as unknown as Db)).toThrow('begin failed');
    expect(db.execStatements).not.toContain('ROLLBACK');
  });

  test('installs durable run ownership and unique job completion linkage idempotently', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xxx-migrations-'));
    const db = openDatabase(path.join(root, 'db.sqlite'));

    applyMigrations(db);

    const jobColumns = db.prepare('PRAGMA table_info(download_jobs)').all().map((row) => String((row as { name: unknown }).name));
    const mediaColumns = db.prepare('PRAGMA table_info(media_items)').all().map((row) => String((row as { name: unknown }).name));
    const migrationIds = db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((row) => Number((row as { id: unknown }).id));
    expect(jobColumns).toEqual(expect.arrayContaining(['active_run_id', 'output_relative_path']));
    expect(mediaColumns).toContain('job_id');
    expect(migrationIds).toContain(5);
  });
});
