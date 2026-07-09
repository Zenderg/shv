import { describe, expect, test } from 'vitest';

import { applyMigrations } from '../../src/server/storage/migrations.js';
import type { Db } from '../../src/server/storage/database.js';

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
});
