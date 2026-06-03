import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import { app } from 'electron'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

export function initDb(): void {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'editor.db')

  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA foreign_keys=ON')

  runMigrations(db)
}

// Migrations embedded inline — works in both dev and packaged builds
const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS page_management_sessions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        document_version_id TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','applied','discarded','stale')),
        source_page_count INTEGER NOT NULL,
        source_content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pms_doc ON page_management_sessions(document_id, document_version_id, status);

      CREATE TABLE IF NOT EXISTS session_pages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES page_management_sessions(id) ON DELETE CASCADE,
        original_page_number INTEGER NOT NULL,
        current_order_index INTEGER NOT NULL,
        rotation_deg INTEGER NOT NULL DEFAULT 0 CHECK(rotation_deg IN (0, 90, 180, 270)),
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(session_id, original_page_number)
      );
      CREATE INDEX IF NOT EXISTS idx_sp_session_order ON session_pages(session_id, current_order_index);
      CREATE INDEX IF NOT EXISTS idx_sp_session_page ON session_pages(session_id, original_page_number);

      CREATE TABLE IF NOT EXISTS session_actions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES page_management_sessions(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL CHECK(action_type IN ('rotate','reorder','delete','restore','extract')),
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        undone_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sa_session ON session_actions(session_id, created_at);

      CREATE TABLE IF NOT EXISTS extraction_jobs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES page_management_sessions(id) ON DELETE CASCADE,
        selection_spec TEXT NOT NULL,
        include_rotations INTEGER NOT NULL DEFAULT 1,
        preserve_order INTEGER NOT NULL DEFAULT 1,
        output_format TEXT NOT NULL DEFAULT 'pdf' CHECK(output_format IN ('pdf','docx')),
        destination_path TEXT,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','canceled')),
        requested_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        finished_at TEXT,
        page_count INTEGER,
        result_file_path TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ej_session_status ON extraction_jobs(session_id, status);

      CREATE TABLE IF NOT EXISTS document_page_overrides (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        document_version_id TEXT,
        page_number INTEGER NOT NULL,
        order_index INTEGER NOT NULL,
        rotation_deg INTEGER NOT NULL DEFAULT 0 CHECK(rotation_deg IN (0, 90, 180, 270)),
        is_deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dpo_doc_page ON document_page_overrides(document_id, document_version_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_dpo_doc ON document_page_overrides(document_id, document_version_id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS ocr_jobs (
        id TEXT PRIMARY KEY,
        source_pdf_uri TEXT NOT NULL,
        source_pdf_sha256 TEXT NOT NULL,
        page_count INTEGER NOT NULL,
        requested_languages TEXT NOT NULL DEFAULT 'eng',
        ocr_engine TEXT NOT NULL DEFAULT 'tesseract',
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','canceled','partial')),
        priority INTEGER NOT NULL DEFAULT 5,
        target_document_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ocr_jobs_status ON ocr_jobs(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_ocr_jobs_doc ON ocr_jobs(target_document_id);

      CREATE TABLE IF NOT EXISTS ocr_pages (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES ocr_jobs(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL,
        width_px INTEGER,
        height_px INTEGER,
        dpi INTEGER,
        rotation_deg INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','completed','failed','skipped')),
        language_detected TEXT,
        confidence_avg_ppm INTEGER,
        text_full TEXT,
        image_uri TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(job_id, page_number)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ocr_pages_job_page ON ocr_pages(job_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_ocr_pages_job ON ocr_pages(job_id);

      CREATE TABLE IF NOT EXISTS ocr_blocks (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES ocr_pages(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'word' CHECK(kind IN ('block','paragraph','line','word')),
        seq INTEGER NOT NULL,
        bbox_x INTEGER NOT NULL DEFAULT 0,
        bbox_y INTEGER NOT NULL DEFAULT 0,
        bbox_w INTEGER NOT NULL DEFAULT 0,
        bbox_h INTEGER NOT NULL DEFAULT 0,
        text TEXT NOT NULL DEFAULT '',
        lang TEXT,
        confidence_ppm INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ocr_blocks_page ON ocr_blocks(page_id, seq);

      CREATE TABLE IF NOT EXISTS ocr_artifacts (
        id TEXT PRIMARY KEY,
        page_id TEXT NOT NULL REFERENCES ocr_pages(id) ON DELETE CASCADE,
        format TEXT NOT NULL CHECK(format IN ('hocr','alto','json','tsv')),
        content TEXT NOT NULL,
        checksum_sha256 TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ocr_artifacts_page ON ocr_artifacts(page_id);
    `,
  },
]

function runMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const applied = database
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number }>
  const appliedVersions = new Set(applied.map((r) => r.version))

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue
    database.exec(migration.sql)
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version)
  }
}

export function closeDb(): void {
  db?.close()
  db = null
}
