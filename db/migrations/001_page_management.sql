-- Page Management: sessions, per-page state, audit log, extraction jobs, durable overrides

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
  -- current_order_index uniqueness enforced at application layer to allow bulk reorder
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
