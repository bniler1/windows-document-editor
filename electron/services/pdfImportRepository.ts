/**
 * Repository layer for PDF Scan & Reconstruct entities.
 * Provides CRUD operations for all 11 tables in migration 003.
 */
import { v4 as uuidv4 } from 'uuid'
import { getDb } from './database'

// ── Types ─────────────────────────────────────────────────────

export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL' | 'CANCELLED'
export type ImportMode = 'EditableFlow' | 'ExactLayout'
export type ElementType = 'TEXT' | 'IMAGE' | 'TABLE' | 'SHAPE' | 'LINE' | 'ANNOTATION' |
  'FOOTER' | 'HEADER' | 'LIST_BULLET' | 'LINK_AREA' | 'FOOTNOTE_MARKER' | 'FIGURE' | 'CAPTION'
export type AnomalySeverity = 'info' | 'warning' | 'error' | 'critical'

export interface PdfImportJob {
  id: string; sourceUri: string; sourceSha256: string; odLoaderVersion: string
  status: JobStatus; pageCount: number | null; pageRangeStart: number | null; pageRangeEnd: number | null
  mode: ImportMode; docLang: string | null; ocrEnabled: boolean; ocrLanguages: string | null
  startedAt: string | null; completedAt: string | null; errorCode: string | null; errorMessage: string | null
  duplicateOfJobId: string | null; createdAt: string; updatedAt: string
}

export interface PdfPage {
  id: string; jobId: string; pageNumber: number; widthPt: number; heightPt: number
  rotationDeg: number; renderDpi: number; ocrApplied: boolean; ocrLanguage: string | null
  ocrConfidence: number | null; status: string
}

export interface PdfElement {
  id: string; pageId: string; parentElementId: string | null; type: ElementType
  zIndex: number; readingOrder: number; bboxX: number; bboxY: number; bboxW: number; bboxH: number
  odUid: string | null; confidence: number | null
}

export interface PdfTextRun {
  id: string; elementId: string; seq: number; content: string
  fontFamily: string | null; fontSize: number | null
  bold: boolean; italic: boolean; underline: boolean; colorHex: string | null
  language: string | null; hyphenated: boolean; baselineShift: number
  letterSpacing: number; wordSpacing: number; whitespacePreserved: boolean; confidence: number | null
}

export interface PdfImage {
  id: string; elementId: string; mimeType: string
  widthPx: number | null; heightPx: number | null; dpiX: number | null; dpiY: number | null
  colorSpace: string | null; sha256: string | null; blobPath: string | null; embedded: boolean
}

export interface PdfTable {
  id: string; elementId: string; rows: number; cols: number
  hasHeaderRow: boolean; gridlinesDetected: boolean; confidence: number | null
}

export interface PdfTableCell {
  id: string; tableId: string; rowIndex: number; colIndex: number
  rowSpan: number; colSpan: number; bboxX: number; bboxY: number; bboxW: number; bboxH: number
  contentElementId: string | null
}

export interface PdfLink {
  id: string; elementId: string; targetType: string; targetValue: string | null
  pageTarget: number | null; bboxX: number; bboxY: number; bboxW: number; bboxH: number
}

export interface ReconstructionMap {
  id: string; jobId: string; elementId: string; editorDocId: string
  editorNodeId: string; nodeType: string; fidelityScore: number; lossReason: string | null; roundtripOk: boolean
}

export interface AnomalyLog {
  id: string; jobId: string; pageId: string | null; severity: AnomalySeverity
  code: string; message: string; contextJson: string; createdAt: string
}

// ── Job ───────────────────────────────────────────────────────

export function createJob(opts: {
  sourceUri: string; sourceSha256: string; pageCount?: number
  pageRangeStart?: number; pageRangeEnd?: number; mode?: ImportMode
  ocrEnabled?: boolean; ocrLanguages?: string
}): PdfImportJob {
  const db = getDb()
  const id = uuidv4(); const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO pdf_import_job
      (id, source_uri, source_sha256, status, page_count, page_range_start, page_range_end,
       mode, ocr_enabled, ocr_languages, created_at, updated_at)
    VALUES (?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.sourceUri, opts.sourceSha256, opts.pageCount ?? null,
    opts.pageRangeStart ?? null, opts.pageRangeEnd ?? null,
    opts.mode ?? 'EditableFlow', opts.ocrEnabled ? 1 : 0,
    opts.ocrLanguages ?? null, now, now)
  return getJob(id)!
}

export function getJob(id: string): PdfImportJob | null {
  const r = getDb().prepare('SELECT * FROM pdf_import_job WHERE id=?').get(id) as Record<string, unknown> | undefined
  return r ? mapJob(r) : null
}

export function listJobs(limit = 50, offset = 0): PdfImportJob[] {
  const rows = getDb().prepare('SELECT * FROM pdf_import_job ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset) as Array<Record<string, unknown>>
  return rows.map(mapJob)
}

export function updateJobStatus(id: string, status: JobStatus, extra?: {
  startedAt?: string; completedAt?: string; errorCode?: string; errorMessage?: string; pageCount?: number
}): void {
  const db = getDb(); const now = new Date().toISOString()
  db.prepare(`UPDATE pdf_import_job SET status=?, started_at=COALESCE(?,started_at),
    completed_at=COALESCE(?,completed_at), error_code=COALESCE(?,error_code),
    error_message=COALESCE(?,error_message), page_count=COALESCE(?,page_count), updated_at=? WHERE id=?`)
    .run(status, extra?.startedAt ?? null, extra?.completedAt ?? null,
      extra?.errorCode ?? null, extra?.errorMessage ?? null, extra?.pageCount ?? null, now, id)
}

export function deleteJob(id: string): void {
  getDb().prepare('DELETE FROM pdf_import_job WHERE id=?').run(id)
}

// ── Pages ─────────────────────────────────────────────────────

export function upsertPage(jobId: string, pageNumber: number, opts: Partial<Omit<PdfPage, 'id'|'jobId'|'pageNumber'>> = {}): PdfPage {
  const db = getDb(); const id = uuidv4()
  db.prepare(`
    INSERT INTO pdf_page (id, job_id, page_number, width_pt, height_pt, rotation_deg, render_dpi, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, page_number) DO UPDATE SET
      width_pt=excluded.width_pt, height_pt=excluded.height_pt,
      rotation_deg=excluded.rotation_deg, render_dpi=excluded.render_dpi, status=excluded.status
  `).run(id, jobId, pageNumber, opts.widthPt ?? 595, opts.heightPt ?? 842,
    opts.rotationDeg ?? 0, opts.renderDpi ?? 150, opts.status ?? 'pending')
  return getDb().prepare('SELECT * FROM pdf_page WHERE job_id=? AND page_number=?')
    .get(jobId, pageNumber) as unknown as PdfPage
}

export function getPagesByJob(jobId: string): PdfPage[] {
  return (getDb().prepare('SELECT * FROM pdf_page WHERE job_id=? ORDER BY page_number').all(jobId) as Array<Record<string, unknown>>).map(mapPage)
}

export function updatePageStatus(pageId: string, status: string, ocrData?: { ocrApplied?: boolean; ocrLanguage?: string; ocrConfidence?: number }): void {
  const db = getDb()
  db.prepare('UPDATE pdf_page SET status=?, ocr_applied=COALESCE(?,ocr_applied), ocr_language=COALESCE(?,ocr_language), ocr_confidence=COALESCE(?,ocr_confidence) WHERE id=?')
    .run(status, ocrData?.ocrApplied !== undefined ? (ocrData.ocrApplied ? 1 : 0) : null,
      ocrData?.ocrLanguage ?? null, ocrData?.ocrConfidence ?? null, pageId)
}

// ── Elements ──────────────────────────────────────────────────

export function insertElement(pageId: string, type: ElementType, opts: {
  readingOrder?: number; bboxX?: number; bboxY?: number; bboxW?: number; bboxH?: number
  zIndex?: number; parentElementId?: string; odUid?: string; confidence?: number
}): string {
  const db = getDb(); const id = uuidv4()
  db.prepare(`
    INSERT INTO pdf_element (id, page_id, parent_element_id, type, z_index, reading_order,
      bbox_x, bbox_y, bbox_w, bbox_h, od_uid, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pageId, opts.parentElementId ?? null, type, opts.zIndex ?? 0,
    opts.readingOrder ?? 0, opts.bboxX ?? 0, opts.bboxY ?? 0, opts.bboxW ?? 0, opts.bboxH ?? 0,
    opts.odUid ?? null, opts.confidence ?? null)
  return id
}

export function getElementsByPage(pageId: string): PdfElement[] {
  return (getDb().prepare('SELECT * FROM pdf_element WHERE page_id=? ORDER BY reading_order').all(pageId) as Array<Record<string, unknown>>).map(mapElement)
}

// ── Text runs ─────────────────────────────────────────────────

export function insertTextRun(elementId: string, seq: number, opts: {
  content: string; fontFamily?: string; fontSize?: number; bold?: boolean; italic?: boolean
  underline?: boolean; colorHex?: string; language?: string; confidence?: number
}): string {
  const db = getDb(); const id = uuidv4()
  db.prepare(`
    INSERT INTO pdf_text_run (id, element_id, seq, content, font_family, font_size,
      bold, italic, underline, color_hex, language, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, elementId, seq, opts.content, opts.fontFamily ?? null, opts.fontSize ?? null,
    opts.bold ? 1 : 0, opts.italic ? 1 : 0, opts.underline ? 1 : 0,
    opts.colorHex ?? null, opts.language ?? null, opts.confidence ?? null)
  return id
}

export function getTextRunsByElement(elementId: string): PdfTextRun[] {
  return (getDb().prepare('SELECT * FROM pdf_text_run WHERE element_id=? ORDER BY seq').all(elementId) as Array<Record<string, unknown>>).map(mapTextRun)
}

// ── Images ────────────────────────────────────────────────────

export function insertImage(elementId: string, opts: {
  mimeType?: string; widthPx?: number; heightPx?: number; dpiX?: number; dpiY?: number
  sha256?: string; blobPath?: string
}): string {
  const db = getDb(); const id = uuidv4()
  db.prepare(`
    INSERT INTO pdf_image (id, element_id, mime_type, width_px, height_px, dpi_x, dpi_y, sha256, blob_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, elementId, opts.mimeType ?? 'image/png', opts.widthPx ?? null, opts.heightPx ?? null,
    opts.dpiX ?? null, opts.dpiY ?? null, opts.sha256 ?? null, opts.blobPath ?? null)
  return id
}

// ── Tables ────────────────────────────────────────────────────

export function insertTable(elementId: string, rows: number, cols: number, opts: {
  hasHeaderRow?: boolean; gridlinesDetected?: boolean; confidence?: number
} = {}): string {
  const db = getDb(); const id = uuidv4()
  db.prepare('INSERT INTO pdf_table (id, element_id, rows, cols, has_header_row, gridlines_detected, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, elementId, rows, cols, opts.hasHeaderRow ? 1 : 0, opts.gridlinesDetected ? 1 : 0, opts.confidence ?? null)
  return id
}

export function insertTableCell(tableId: string, row: number, col: number, opts: {
  rowSpan?: number; colSpan?: number; bboxX?: number; bboxY?: number; bboxW?: number; bboxH?: number
  contentElementId?: string
} = {}): string {
  const db = getDb(); const id = uuidv4()
  db.prepare(`
    INSERT INTO pdf_table_cell (id, table_id, row_index, col_index, row_span, col_span,
      bbox_x, bbox_y, bbox_w, bbox_h, content_element_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tableId, row, col, opts.rowSpan ?? 1, opts.colSpan ?? 1,
    opts.bboxX ?? 0, opts.bboxY ?? 0, opts.bboxW ?? 0, opts.bboxH ?? 0,
    opts.contentElementId ?? null)
  return id
}

export function getTableCells(tableId: string): PdfTableCell[] {
  return (getDb().prepare('SELECT * FROM pdf_table_cell WHERE table_id=? ORDER BY row_index, col_index').all(tableId) as Array<Record<string, unknown>>).map(mapTableCell)
}

// ── Links ─────────────────────────────────────────────────────

export function insertLink(elementId: string, targetType: string, targetValue: string | null, opts: {
  pageTarget?: number; bboxX?: number; bboxY?: number; bboxW?: number; bboxH?: number
} = {}): string {
  const db = getDb(); const id = uuidv4()
  db.prepare('INSERT INTO pdf_link (id, element_id, target_type, target_value, page_target, bbox_x, bbox_y, bbox_w, bbox_h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, elementId, targetType, targetValue, opts.pageTarget ?? null,
      opts.bboxX ?? 0, opts.bboxY ?? 0, opts.bboxW ?? 0, opts.bboxH ?? 0)
  return id
}

// ── Reconstruction map ────────────────────────────────────────

export function upsertReconstructionMap(jobId: string, elementId: string, editorDocId: string,
  editorNodeId: string, nodeType: string, fidelityScore = 1.0, lossReason?: string): void {
  const db = getDb(); const id = uuidv4()
  db.prepare(`
    INSERT INTO reconstruction_map (id, job_id, element_id, editor_doc_id, editor_node_id, node_type, fidelity_score, loss_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, element_id) DO UPDATE SET
      editor_node_id=excluded.editor_node_id, fidelity_score=excluded.fidelity_score, loss_reason=excluded.loss_reason
  `).run(id, jobId, elementId, editorDocId, editorNodeId, nodeType, fidelityScore, lossReason ?? null)
}

export function getReconstructionMap(jobId: string): ReconstructionMap[] {
  return (getDb().prepare('SELECT * FROM reconstruction_map WHERE job_id=?').all(jobId) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string, jobId: r.job_id as string, elementId: r.element_id as string,
    editorDocId: r.editor_doc_id as string, editorNodeId: r.editor_node_id as string,
    nodeType: r.node_type as string, fidelityScore: r.fidelity_score as number,
    lossReason: r.loss_reason as string | null, roundtripOk: Boolean(r.roundtrip_ok),
  }))
}

// ── Export artifacts ──────────────────────────────────────────

export function createExportArtifact(jobId: string, format: string): string {
  const db = getDb(); const id = uuidv4()
  db.prepare('INSERT INTO export_artifact (id, job_id, format, status) VALUES (?, ?, ?, \'PENDING\')').run(id, jobId, format)
  return id
}

export function updateExportArtifact(id: string, status: string, path?: string, errorMessage?: string): void {
  const db = getDb()
  db.prepare('UPDATE export_artifact SET status=?, path=COALESCE(?,path), error_message=COALESCE(?,error_message), completed_at=CASE WHEN status IN (\'DONE\',\'ERROR\') THEN datetime(\'now\') ELSE completed_at END WHERE id=?')
    .run(status, path ?? null, errorMessage ?? null, id)
}

// ── Anomaly log ───────────────────────────────────────────────

export function logAnomaly(jobId: string, severity: AnomalySeverity, code: string, message: string,
  context: Record<string, unknown> = {}, pageId?: string): void {
  const db = getDb(); const id = uuidv4()
  db.prepare('INSERT INTO anomaly_log (id, job_id, page_id, severity, code, message, context_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, jobId, pageId ?? null, severity, code, message, JSON.stringify(context))
}

export function getAnomalies(jobId: string): AnomalyLog[] {
  return (getDb().prepare('SELECT * FROM anomaly_log WHERE job_id=? ORDER BY created_at').all(jobId) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string, jobId: r.job_id as string, pageId: r.page_id as string | null,
    severity: r.severity as AnomalySeverity, code: r.code as string, message: r.message as string,
    contextJson: r.context_json as string, createdAt: r.created_at as string,
  }))
}

// ── Telemetry ─────────────────────────────────────────────────

export function getJobMetrics(jobId: string): {
  totalPages: number; completedPages: number; failedPages: number
  totalElements: number; textRuns: number; images: number; tables: number
  anomalyCount: number; avgFidelity: number
} {
  const db = getDb()
  const pageStats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
    FROM pdf_page WHERE job_id=?`).get(jobId) as Record<string, number>

  const elemStats = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN type='TEXT' THEN 1 ELSE 0 END) as text_els,
      SUM(CASE WHEN type='IMAGE' THEN 1 ELSE 0 END) as images,
      SUM(CASE WHEN type='TABLE' THEN 1 ELSE 0 END) as tables
    FROM pdf_element e JOIN pdf_page p ON e.page_id=p.id WHERE p.job_id=?`).get(jobId) as Record<string, number>

  const textRuns = (db.prepare(`SELECT COUNT(*) as c FROM pdf_text_run tr JOIN pdf_element e ON tr.element_id=e.id JOIN pdf_page p ON e.page_id=p.id WHERE p.job_id=?`).get(jobId) as { c: number }).c
  const anomalies = (db.prepare('SELECT COUNT(*) as c FROM anomaly_log WHERE job_id=?').get(jobId) as { c: number }).c
  const fidelity = (db.prepare('SELECT AVG(fidelity_score) as avg FROM reconstruction_map WHERE job_id=?').get(jobId) as { avg: number | null }).avg

  return {
    totalPages: pageStats.total ?? 0, completedPages: pageStats.completed ?? 0, failedPages: pageStats.failed ?? 0,
    totalElements: elemStats.total ?? 0, textRuns, images: elemStats.images ?? 0, tables: elemStats.tables ?? 0,
    anomalyCount: anomalies, avgFidelity: fidelity ?? 1.0,
  }
}

// ── Mappers ───────────────────────────────────────────────────

function mapJob(r: Record<string, unknown>): PdfImportJob {
  return {
    id: r.id as string, sourceUri: r.source_uri as string, sourceSha256: r.source_sha256 as string,
    odLoaderVersion: r.od_loader_version as string, status: r.status as JobStatus,
    pageCount: r.page_count as number | null, pageRangeStart: r.page_range_start as number | null,
    pageRangeEnd: r.page_range_end as number | null, mode: r.mode as ImportMode,
    docLang: r.doc_lang as string | null, ocrEnabled: Boolean(r.ocr_enabled),
    ocrLanguages: r.ocr_languages as string | null, startedAt: r.started_at as string | null,
    completedAt: r.completed_at as string | null, errorCode: r.error_code as string | null,
    errorMessage: r.error_message as string | null, duplicateOfJobId: r.duplicate_of_job_id as string | null,
    createdAt: r.created_at as string, updatedAt: r.updated_at as string,
  }
}

function mapPage(r: Record<string, unknown>): PdfPage {
  return {
    id: r.id as string, jobId: r.job_id as string, pageNumber: r.page_number as number,
    widthPt: r.width_pt as number, heightPt: r.height_pt as number, rotationDeg: r.rotation_deg as number,
    renderDpi: r.render_dpi as number, ocrApplied: Boolean(r.ocr_applied),
    ocrLanguage: r.ocr_language as string | null, ocrConfidence: r.ocr_confidence as number | null,
    status: r.status as string,
  }
}

function mapElement(r: Record<string, unknown>): PdfElement {
  return {
    id: r.id as string, pageId: r.page_id as string, parentElementId: r.parent_element_id as string | null,
    type: r.type as ElementType, zIndex: r.z_index as number, readingOrder: r.reading_order as number,
    bboxX: r.bbox_x as number, bboxY: r.bbox_y as number, bboxW: r.bbox_w as number, bboxH: r.bbox_h as number,
    odUid: r.od_uid as string | null, confidence: r.confidence as number | null,
  }
}

function mapTextRun(r: Record<string, unknown>): PdfTextRun {
  return {
    id: r.id as string, elementId: r.element_id as string, seq: r.seq as number, content: r.content as string,
    fontFamily: r.font_family as string | null, fontSize: r.font_size as number | null,
    bold: Boolean(r.bold), italic: Boolean(r.italic), underline: Boolean(r.underline),
    colorHex: r.color_hex as string | null, language: r.language as string | null,
    hyphenated: Boolean(r.hyphenated), baselineShift: r.baseline_shift as number,
    letterSpacing: r.letter_spacing as number, wordSpacing: r.word_spacing as number,
    whitespacePreserved: Boolean(r.whitespace_preserved), confidence: r.confidence as number | null,
  }
}

function mapTableCell(r: Record<string, unknown>): PdfTableCell {
  return {
    id: r.id as string, tableId: r.table_id as string, rowIndex: r.row_index as number,
    colIndex: r.col_index as number, rowSpan: r.row_span as number, colSpan: r.col_span as number,
    bboxX: r.bbox_x as number, bboxY: r.bbox_y as number, bboxW: r.bbox_w as number, bboxH: r.bbox_h as number,
    contentElementId: r.content_element_id as string | null,
  }
}
