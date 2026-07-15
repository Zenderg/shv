import type { Db } from './database.js';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'initial_schema',
    sql: `
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        folder_name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE media_items (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        thumbnail_path TEXT,
        duration_seconds REAL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        container TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        source_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX media_items_category_id_idx ON media_items(category_id);

      CREATE TABLE download_jobs (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        status TEXT NOT NULL,
        selected_candidate_id TEXT,
        title_hint TEXT,
        error_code TEXT,
        error_message TEXT,
        progress REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX download_jobs_status_created_at_idx ON download_jobs(status, created_at);

      CREATE TABLE media_candidates (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES download_jobs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        url TEXT NOT NULL,
        content_type TEXT,
        manifest_type TEXT,
        resolution TEXT,
        bitrate INTEGER,
        duration_seconds REAL,
        size_bytes INTEGER,
        confidence REAL NOT NULL,
        headers_json TEXT NOT NULL DEFAULT '{}',
        discovered_at TEXT NOT NULL
      );

      CREATE INDEX media_candidates_job_id_idx ON media_candidates(job_id);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `
  },
  {
    id: 2,
    name: 'media_item_dimensions',
    sql: `
      ALTER TABLE media_items ADD COLUMN width INTEGER;
      ALTER TABLE media_items ADD COLUMN height INTEGER;
    `
  },
  {
    id: 3,
    name: 'candidate_subtitle_tracks',
    sql: `
      ALTER TABLE media_candidates ADD COLUMN subtitle_tracks_json TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    id: 4,
    name: 'honest_stage_progress',
    sql: `
      ALTER TABLE download_jobs ADD COLUMN stage_progress REAL;
      ALTER TABLE download_jobs ADD COLUMN progress_label TEXT;
    `
  },
  {
    id: 5,
    name: 'durable_job_runs_and_completion',
    sql: `
      ALTER TABLE download_jobs ADD COLUMN active_run_id TEXT;
      ALTER TABLE download_jobs ADD COLUMN output_relative_path TEXT;
      ALTER TABLE media_items ADD COLUMN job_id TEXT REFERENCES download_jobs(id) ON DELETE SET NULL;

      CREATE UNIQUE INDEX download_jobs_output_relative_path_idx
        ON download_jobs(output_relative_path)
        WHERE output_relative_path IS NOT NULL;
      CREATE UNIQUE INDEX media_items_job_id_idx
        ON media_items(job_id)
        WHERE job_id IS NOT NULL;
    `
  },
  {
    id: 6,
    name: 'media_library_keyset_pagination',
    sql: `
      CREATE INDEX media_items_category_created_at_id_idx
        ON media_items(category_id, created_at DESC, id DESC);
    `
  },
  {
    id: 7,
    name: 'derived_media_labels',
    sql: `
      ALTER TABLE download_jobs ADD COLUMN labels_json TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE media_item_labels (
        media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        label_key TEXT NOT NULL,
        PRIMARY KEY (media_item_id, label_key)
      );

      CREATE INDEX media_item_labels_key_media_idx
        ON media_item_labels(label_key, media_item_id);
    `
  }
];

export function applyMigrations(db: Db): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');

  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => Number((row as { id: number }).id)));

  const apply = (migration: Migration) => {
    let transactionStarted = false;

    try {
      db.exec('BEGIN');
      transactionStarted = true;
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString()
      );
      db.exec('COMMIT');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        db.exec('ROLLBACK');
      }

      throw error;
    }
  };

  for (const migration of migrations) {
    if (!applied.has(migration.id)) {
      apply(migration);
    }
  }
}
