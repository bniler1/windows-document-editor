-- OCR: jobs, per-page results, fine-grained blocks, raw artifacts

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
