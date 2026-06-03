import { v4 as uuidv4 } from 'uuid'
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib'
import fs from 'fs'
import { getDb } from './database'

// ── DB init (annotations tables created inline if missing) ───────────────────

export function ensureAnnotationTables(): void {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS watermarks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text','image')),
      content TEXT NOT NULL,
      opacity REAL NOT NULL DEFAULT 0.3,
      rotation_deg REAL NOT NULL DEFAULT 45,
      color TEXT NOT NULL DEFAULT '#cccccc',
      font_size INTEGER NOT NULL DEFAULT 48,
      position TEXT NOT NULL DEFAULT 'diagonal',
      page_range TEXT NOT NULL DEFAULT 'all',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wm_doc ON watermarks(document_id);

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('highlight','comment','redaction')),
      x REAL NOT NULL DEFAULT 0,
      y REAL NOT NULL DEFAULT 0,
      width REAL NOT NULL DEFAULT 0,
      height REAL NOT NULL DEFAULT 0,
      color TEXT NOT NULL DEFAULT '#ffff00',
      content TEXT,
      author TEXT NOT NULL DEFAULT 'User',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
      parent_id TEXT,
      is_applied INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ann_doc ON annotations(document_id, page_number);
  `)
}

// ── Watermark ─────────────────────────────────────────────────────────────────

export interface WatermarkConfig {
  documentId: string
  type: 'text' | 'image'
  content: string
  opacity?: number
  rotationDeg?: number
  color?: string
  fontSize?: number
  position?: 'diagonal' | 'horizontal' | 'center'
  pageRange?: string
}

export function upsertWatermark(config: WatermarkConfig): string {
  const db = getDb()
  ensureAnnotationTables()

  // Remove existing watermark for this doc
  db.prepare('DELETE FROM watermarks WHERE document_id=?').run(config.documentId)

  const id = uuidv4()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO watermarks (id, document_id, type, content, opacity, rotation_deg, color, font_size, position, page_range, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, config.documentId, config.type, config.content,
    config.opacity ?? 0.3, config.rotationDeg ?? 45,
    config.color ?? '#cccccc', config.fontSize ?? 48,
    config.position ?? 'diagonal', config.pageRange ?? 'all',
    now, now,
  )
  return id
}

export function getWatermark(documentId: string): WatermarkConfig | null {
  const db = getDb()
  ensureAnnotationTables()
  const row = db.prepare('SELECT * FROM watermarks WHERE document_id=?').get(documentId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    documentId: row.document_id as string,
    type: row.type as 'text' | 'image',
    content: row.content as string,
    opacity: row.opacity as number,
    rotationDeg: row.rotation_deg as number,
    color: row.color as string,
    fontSize: row.font_size as number,
    position: row.position as WatermarkConfig['position'],
    pageRange: row.page_range as string,
  }
}

export function removeWatermark(documentId: string): void {
  const db = getDb()
  ensureAnnotationTables()
  db.prepare('DELETE FROM watermarks WHERE document_id=?').run(documentId)
}

// Apply watermark to a PDF file and write output
export async function applyWatermarkToPdf(
  inputPath: string,
  outputPath: string,
  config: WatermarkConfig,
): Promise<void> {
  const bytes = fs.readFileSync(inputPath)
  const doc = await PDFDocument.load(bytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)

  const hexToRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '')
    const r = parseInt(clean.slice(0, 2), 16) / 255
    const g = parseInt(clean.slice(2, 4), 16) / 255
    const b = parseInt(clean.slice(4, 6), 16) / 255
    return [r, g, b]
  }

  const [r, g, b] = hexToRgb(config.color ?? '#cccccc')
  const opacity = config.opacity ?? 0.3
  const rotDeg = config.rotationDeg ?? 45
  const fontSize = config.fontSize ?? 48
  const text = config.content

  for (let i = 0; i < doc.getPageCount(); i++) {
    const page = doc.getPage(i)
    const { width, height } = page.getSize()

    const textWidth = font.widthOfTextAtSize(text, fontSize)
    const x = config.position === 'diagonal' ? (width - textWidth) / 2 : (width - textWidth) / 2
    const y = config.position === 'diagonal' ? height / 2 : height / 2

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(r, g, b),
      opacity,
      rotate: config.position === 'diagonal' ? degrees(rotDeg) : degrees(0),
    })
  }

  const outBytes = await doc.save()
  fs.writeFileSync(outputPath, outBytes)
}

// ── Annotations (highlight / comment) ────────────────────────────────────────

export interface AnnotationRecord {
  id: string
  documentId: string
  pageNumber: number
  type: 'highlight' | 'comment' | 'redaction'
  x: number; y: number; width: number; height: number
  color: string
  content: string | null
  author: string
  status: 'open' | 'resolved'
  parentId: string | null
  isApplied: boolean
  createdAt: string
  updatedAt: string
}

export function addAnnotation(
  documentId: string,
  pageNumber: number,
  type: AnnotationRecord['type'],
  bounds: { x: number; y: number; width: number; height: number },
  opts?: { color?: string; content?: string; author?: string; parentId?: string },
): AnnotationRecord {
  const db = getDb()
  ensureAnnotationTables()

  const id = uuidv4()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO annotations (id, document_id, page_number, type, x, y, width, height, color, content, author, parent_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, documentId, pageNumber, type,
    bounds.x, bounds.y, bounds.width, bounds.height,
    opts?.color ?? '#ffff00',
    opts?.content ?? null,
    opts?.author ?? 'User',
    opts?.parentId ?? null,
    now, now,
  )
  return getAnnotation(id)!
}

export function getAnnotation(id: string): AnnotationRecord | null {
  const db = getDb()
  ensureAnnotationTables()
  const row = db.prepare('SELECT * FROM annotations WHERE id=?').get(id) as Record<string, unknown> | undefined
  return row ? mapAnnotation(row) : null
}

export function getAnnotations(documentId: string, pageNumber?: number): AnnotationRecord[] {
  const db = getDb()
  ensureAnnotationTables()
  const rows = pageNumber !== undefined
    ? db.prepare('SELECT * FROM annotations WHERE document_id=? AND page_number=? ORDER BY created_at').all(documentId, pageNumber)
    : db.prepare('SELECT * FROM annotations WHERE document_id=? ORDER BY page_number, created_at').all(documentId)
  return (rows as Array<Record<string, unknown>>).map(mapAnnotation)
}

export function updateAnnotation(
  id: string,
  updates: Partial<Pick<AnnotationRecord, 'content' | 'color' | 'status'>>,
): AnnotationRecord | null {
  const db = getDb()
  const now = new Date().toISOString()
  if (updates.content !== undefined) {
    db.prepare('UPDATE annotations SET content=?, updated_at=? WHERE id=?').run(updates.content, now, id)
  }
  if (updates.color !== undefined) {
    db.prepare('UPDATE annotations SET color=?, updated_at=? WHERE id=?').run(updates.color, now, id)
  }
  if (updates.status !== undefined) {
    db.prepare('UPDATE annotations SET status=?, updated_at=? WHERE id=?').run(updates.status, now, id)
  }
  return getAnnotation(id)
}

export function deleteAnnotation(id: string): void {
  const db = getDb()
  ensureAnnotationTables()
  db.prepare('DELETE FROM annotations WHERE id=? OR parent_id=?').run(id, id)
}

// ── Redaction ─────────────────────────────────────────────────────────────────

export async function applyRedactionsToPdf(
  inputPath: string,
  outputPath: string,
  documentId: string,
): Promise<{ redactedCount: number }> {
  const db = getDb()
  ensureAnnotationTables()

  const redactions = db.prepare(
    'SELECT * FROM annotations WHERE document_id=? AND type=\'redaction\' AND is_applied=0',
  ).all(documentId) as Array<Record<string, unknown>>

  if (redactions.length === 0) return { redactedCount: 0 }

  const bytes = fs.readFileSync(inputPath)
  const doc = await PDFDocument.load(bytes)
  const now = new Date().toISOString()

  for (const r of redactions) {
    const pageNum = (r.page_number as number) - 1
    if (pageNum < 0 || pageNum >= doc.getPageCount()) continue

    const page = doc.getPage(pageNum)
    const { height } = page.getSize()

    // Draw solid black rectangle over the redacted area (PDF coordinates: origin bottom-left)
    const rx = r.x as number
    const ry = height - (r.y as number) - (r.height as number)

    page.drawRectangle({
      x: rx,
      y: ry,
      width: r.width as number,
      height: r.height as number,
      color: rgb(0, 0, 0),
      opacity: 1,
    })

    db.prepare('UPDATE annotations SET is_applied=1, updated_at=? WHERE id=?').run(now, r.id as string)
  }

  const outBytes = await doc.save()
  fs.writeFileSync(outputPath, outBytes)

  return { redactedCount: redactions.length }
}

// ── Flatten annotations into PDF ──────────────────────────────────────────────

export async function flattenAnnotationsToPdf(
  inputPath: string,
  outputPath: string,
  documentId: string,
): Promise<{ annotationsFlattenned: number }> {
  const db = getDb()
  ensureAnnotationTables()

  const annotations = db.prepare(
    'SELECT * FROM annotations WHERE document_id=? AND type IN (\'highlight\') ORDER BY page_number',
  ).all(documentId) as Array<Record<string, unknown>>

  const bytes = fs.readFileSync(inputPath)
  const doc = await PDFDocument.load(bytes)

  for (const ann of annotations) {
    const pageNum = (ann.page_number as number) - 1
    if (pageNum < 0 || pageNum >= doc.getPageCount()) continue

    const page = doc.getPage(pageNum)
    const { height } = page.getSize()
    const color = (ann.color as string) ?? '#ffff00'
    const clean = color.replace('#', '')
    const cr = parseInt(clean.slice(0, 2), 16) / 255
    const cg = parseInt(clean.slice(2, 4), 16) / 255
    const cb = parseInt(clean.slice(4, 6), 16) / 255

    page.drawRectangle({
      x: ann.x as number,
      y: height - (ann.y as number) - (ann.height as number),
      width: ann.width as number,
      height: ann.height as number,
      color: rgb(cr, cg, cb),
      opacity: 0.4,
    })
  }

  const outBytes = await doc.save()
  fs.writeFileSync(outputPath, outBytes)
  return { annotationsFlattenned: annotations.length }
}

function mapAnnotation(row: Record<string, unknown>): AnnotationRecord {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    pageNumber: row.page_number as number,
    type: row.type as AnnotationRecord['type'],
    x: row.x as number,
    y: row.y as number,
    width: row.width as number,
    height: row.height as number,
    color: row.color as string,
    content: (row.content as string | null) ?? null,
    author: row.author as string,
    status: row.status as 'open' | 'resolved',
    parentId: (row.parent_id as string | null) ?? null,
    isApplied: Boolean(row.is_applied),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}
