-- PDF Scan & Reconstruct (OpenDataLoader Integration)
-- All tables needed to persist import jobs, extracted elements, and reconstruction mappings.

CREATE TABLE IF NOT EXISTS pdf_import_job (
  id TEXT PRIMARY KEY,
  source_uri TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  od_loader_version TEXT NOT NULL DEFAULT 'pdfjs-4.x',
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','PARTIAL','CANCELLED')),
  page_count INTEGER,
  page_range_start INTEGER,
  page_range_end INTEGER,
  mode TEXT NOT NULL DEFAULT 'EditableFlow' CHECK(mode IN ('EditableFlow','ExactLayout')),
  doc_lang TEXT,
  ocr_enabled INTEGER NOT NULL DEFAULT 0,
  ocr_languages TEXT,
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  duplicate_of_job_id TEXT REFERENCES pdf_import_job(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pij_status ON pdf_import_job(status, started_at);

CREATE TABLE IF NOT EXISTS pdf_page (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES pdf_import_job(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  width_pt REAL NOT NULL DEFAULT 595,
  height_pt REAL NOT NULL DEFAULT 842,
  rotation_deg INTEGER NOT NULL DEFAULT 0 CHECK(rotation_deg IN (0,90,180,270)),
  render_dpi INTEGER NOT NULL DEFAULT 150,
  ocr_applied INTEGER NOT NULL DEFAULT 0,
  ocr_language TEXT,
  ocr_confidence REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
  UNIQUE(job_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_pp_job ON pdf_page(job_id, page_number);

CREATE TABLE IF NOT EXISTS pdf_element (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pdf_page(id) ON DELETE CASCADE,
  parent_element_id TEXT REFERENCES pdf_element(id),
  type TEXT NOT NULL CHECK(type IN (
    'TEXT','IMAGE','TABLE','SHAPE','LINE','ANNOTATION',
    'FOOTER','HEADER','LIST_BULLET','LINK_AREA',
    'FOOTNOTE_MARKER','FIGURE','CAPTION'
  )),
  z_index INTEGER NOT NULL DEFAULT 0,
  reading_order INTEGER NOT NULL DEFAULT 0,
  bbox_x REAL NOT NULL DEFAULT 0,
  bbox_y REAL NOT NULL DEFAULT 0,
  bbox_w REAL NOT NULL DEFAULT 0,
  bbox_h REAL NOT NULL DEFAULT 0,
  od_uid TEXT,
  confidence REAL
);

CREATE INDEX IF NOT EXISTS idx_pe_page ON pdf_element(page_id, reading_order);
CREATE INDEX IF NOT EXISTS idx_pe_type ON pdf_element(type);
CREATE INDEX IF NOT EXISTS idx_pe_uid ON pdf_element(od_uid);

CREATE TABLE IF NOT EXISTS pdf_text_run (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES pdf_element(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  font_family TEXT,
  font_size REAL,
  bold INTEGER NOT NULL DEFAULT 0,
  italic INTEGER NOT NULL DEFAULT 0,
  underline INTEGER NOT NULL DEFAULT 0,
  color_hex TEXT,
  language TEXT,
  hyphenated INTEGER NOT NULL DEFAULT 0,
  baseline_shift REAL NOT NULL DEFAULT 0,
  letter_spacing REAL NOT NULL DEFAULT 0,
  word_spacing REAL NOT NULL DEFAULT 0,
  whitespace_preserved INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  UNIQUE(element_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ptr_element ON pdf_text_run(element_id, seq);

CREATE TABLE IF NOT EXISTS pdf_image (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES pdf_element(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  width_px INTEGER,
  height_px INTEGER,
  dpi_x INTEGER,
  dpi_y INTEGER,
  color_space TEXT,
  sha256 TEXT,
  blob_path TEXT,
  embedded INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pi_sha256 ON pdf_image(sha256);

CREATE TABLE IF NOT EXISTS pdf_table (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES pdf_element(id) ON DELETE CASCADE,
  rows INTEGER NOT NULL DEFAULT 1,
  cols INTEGER NOT NULL DEFAULT 1,
  has_header_row INTEGER NOT NULL DEFAULT 0,
  gridlines_detected INTEGER NOT NULL DEFAULT 0,
  confidence REAL
);

CREATE TABLE IF NOT EXISTS pdf_table_cell (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES pdf_table(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  col_index INTEGER NOT NULL,
  row_span INTEGER NOT NULL DEFAULT 1,
  col_span INTEGER NOT NULL DEFAULT 1,
  bbox_x REAL NOT NULL DEFAULT 0,
  bbox_y REAL NOT NULL DEFAULT 0,
  bbox_w REAL NOT NULL DEFAULT 0,
  bbox_h REAL NOT NULL DEFAULT 0,
  content_element_id TEXT REFERENCES pdf_element(id),
  UNIQUE(table_id, row_index, col_index)
);

CREATE INDEX IF NOT EXISTS idx_ptc_table ON pdf_table_cell(table_id, row_index, col_index);

CREATE TABLE IF NOT EXISTS pdf_link (
  id TEXT PRIMARY KEY,
  element_id TEXT NOT NULL REFERENCES pdf_element(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'URL' CHECK(target_type IN ('URL','INTERNAL','EMAIL','FILE')),
  target_value TEXT,
  page_target INTEGER,
  bbox_x REAL NOT NULL DEFAULT 0,
  bbox_y REAL NOT NULL DEFAULT 0,
  bbox_w REAL NOT NULL DEFAULT 0,
  bbox_h REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pl_element ON pdf_link(element_id);

CREATE TABLE IF NOT EXISTS reconstruction_map (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES pdf_import_job(id) ON DELETE CASCADE,
  element_id TEXT NOT NULL REFERENCES pdf_element(id) ON DELETE CASCADE,
  editor_doc_id TEXT NOT NULL,
  editor_node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  fidelity_score REAL NOT NULL DEFAULT 1.0 CHECK(fidelity_score >= 0 AND fidelity_score <= 1),
  loss_reason TEXT,
  roundtrip_ok INTEGER NOT NULL DEFAULT 1,
  UNIQUE(job_id, element_id)
);

CREATE INDEX IF NOT EXISTS idx_rm_doc ON reconstruction_map(editor_doc_id);
CREATE INDEX IF NOT EXISTS idx_rm_node ON reconstruction_map(editor_node_id);

CREATE TABLE IF NOT EXISTS export_artifact (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES pdf_import_job(id) ON DELETE CASCADE,
  format TEXT NOT NULL CHECK(format IN ('pdf','docx','html','txt')),
  path TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','WRITING','DONE','ERROR')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ea_job ON export_artifact(job_id, format);

CREATE TABLE IF NOT EXISTS anomaly_log (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES pdf_import_job(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pdf_page(id),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('info','warning','error','critical')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_al_job ON anomaly_log(job_id, severity, created_at);
