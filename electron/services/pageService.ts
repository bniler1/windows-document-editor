import { v4 as uuidv4 } from 'uuid'
import { PDFDocument, degrees } from 'pdf-lib'
import fs from 'fs'
import { getDb } from './database'
import type {
  PageManagementSession,
  SessionPage,
  ExtractionJob,
  RotationDeg,
  OutputFormat,
} from '../../src/types'

// ── Session management ────────────────────────────────────────────────────────

export function createSession(
  documentId: string,
  sourcePageCount: number,
  sourceContentHash: string,
  documentVersionId?: string,
): PageManagementSession {
  const db = getDb()

  db.exec(`UPDATE page_management_sessions SET status='stale', updated_at=datetime('now')
           WHERE document_id='${documentId}' AND status='active'`)

  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO page_management_sessions
      (id, document_id, document_version_id, status, source_page_count, source_content_hash, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(id, documentId, documentVersionId ?? null, sourcePageCount, sourceContentHash, now, now)

  db.exec('BEGIN')
  try {
    const insertPage = db.prepare(`
      INSERT INTO session_pages
        (id, session_id, original_page_number, current_order_index, rotation_deg, is_deleted, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, ?)
    `)
    for (let i = 1; i <= sourcePageCount; i++) {
      insertPage.run(uuidv4(), id, i, i, now)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return getSession(id)!
}

export function getSession(sessionId: string): PageManagementSession | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM page_management_sessions WHERE id=?').get(sessionId) as Record<string, unknown> | undefined
  return row ? mapSession(row) : null
}

export function getSessionPages(sessionId: string): SessionPage[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM session_pages WHERE session_id=? ORDER BY current_order_index').all(sessionId) as Array<Record<string, unknown>>
  return rows.map(mapSessionPage)
}

// ── Rotate ────────────────────────────────────────────────────────────────────

export function rotatePages(
  sessionId: string,
  pages: number[],
  rotationDeg: RotationDeg,
): { appliedPages: number[]; warnings: string[] } {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) throw new Error('SESSION_NOT_FOUND')
  if (session.status === 'stale') throw new Error('SESSION_STALE')

  const now = new Date().toISOString()
  const warnings: string[] = []
  const appliedPages: number[] = []
  const prevRotations: Record<number, number> = {}

  db.exec('BEGIN')
  try {
    for (const pageNum of pages) {
      const row = db.prepare(
        'SELECT * FROM session_pages WHERE session_id=? AND original_page_number=?',
      ).get(sessionId, pageNum) as Record<string, unknown> | undefined

      if (!row) {
        warnings.push(`Page ${pageNum} not found in session`)
        continue
      }
      prevRotations[pageNum] = row.rotation_deg as number
      db.prepare('UPDATE session_pages SET rotation_deg=?, updated_at=? WHERE session_id=? AND original_page_number=? AND is_deleted=0')
        .run(rotationDeg, now, sessionId, pageNum)
      appliedPages.push(pageNum)
    }

    db.prepare(`
      INSERT INTO session_actions (id, session_id, action_type, payload, created_at)
      VALUES (?, ?, 'rotate', ?, ?)
    `).run(uuidv4(), sessionId, JSON.stringify({ pages, rotationDeg, prev: prevRotations }), now)

    db.prepare('UPDATE page_management_sessions SET updated_at=? WHERE id=?').run(now, sessionId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { appliedPages, warnings }
}

// ── Reorder ───────────────────────────────────────────────────────────────────

export function reorderPages(
  sessionId: string,
  sourcePages: number[],
  insertAfterPage: number,
): { newOrder: number[] } {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) throw new Error('SESSION_NOT_FOUND')
  if (session.status === 'stale') throw new Error('SESSION_STALE')

  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    const rows = db.prepare(
      'SELECT * FROM session_pages WHERE session_id=? AND is_deleted=0 ORDER BY current_order_index',
    ).all(sessionId) as Array<Record<string, unknown>>

    const sourceSet = new Set(sourcePages)
    const insertAfterRow = rows.find((r) => (r.original_page_number as number) === insertAfterPage)
    const insertAfterIdx = insertAfterPage === 0 ? 0 : ((insertAfterRow?.current_order_index as number) ?? rows.length)

    const remaining = rows.filter((r) => !sourceSet.has(r.original_page_number as number))
    const moving = sourcePages
      .map((p) => rows.find((r) => (r.original_page_number as number) === p))
      .filter(Boolean) as Array<Record<string, unknown>>

    // Insert AFTER the target page, so find first remaining row whose order index exceeds target
    const insertPos = remaining.findIndex((r) => (r.current_order_index as number) > insertAfterIdx)
    const finalOrder = insertAfterPage === 0
      ? [...moving, ...remaining]
      : insertPos === -1
        ? [...remaining, ...moving]
        : [...remaining.slice(0, insertPos), ...moving, ...remaining.slice(insertPos)]

    // First offset by a large amount to avoid transient UNIQUE violations
    const updateIdx = db.prepare('UPDATE session_pages SET current_order_index=?, updated_at=? WHERE id=?')
    const OFFSET = 100_000
    finalOrder.forEach((row, idx) => updateIdx.run(OFFSET + idx + 1, now, row.id as string))
    finalOrder.forEach((row, idx) => updateIdx.run(idx + 1, now, row.id as string))

    db.prepare(`
      INSERT INTO session_actions (id, session_id, action_type, payload, created_at)
      VALUES (?, ?, 'reorder', ?, ?)
    `).run(uuidv4(), sessionId, JSON.stringify({ sourcePages, insertAfterPage }), now)

    db.prepare('UPDATE page_management_sessions SET updated_at=? WHERE id=?').run(now, sessionId)
    db.exec('COMMIT')

    return { newOrder: finalOrder.map((r) => r.original_page_number as number) }
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export function deletePages(
  sessionId: string,
  pages: number[],
): { deletedPages: number[]; remainingPageCount: number } {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) throw new Error('SESSION_NOT_FOUND')

  const now = new Date().toISOString()

  const allActive = db.prepare(
    'SELECT original_page_number FROM session_pages WHERE session_id=? AND is_deleted=0',
  ).all(sessionId) as Array<{ original_page_number: number }>

  const activeSet = new Set(allActive.map((r) => r.original_page_number))
  const toDelete = pages.filter((p) => activeSet.has(p))

  if (activeSet.size - toDelete.length < 1) {
    throw new Error('CANNOT_DELETE_ALL_PAGES')
  }

  db.exec('BEGIN')
  try {
    for (const pageNum of toDelete) {
      db.prepare(
        'UPDATE session_pages SET is_deleted=1, updated_at=? WHERE session_id=? AND original_page_number=?',
      ).run(now, sessionId, pageNum)
    }

    db.prepare(`
      INSERT INTO session_actions (id, session_id, action_type, payload, created_at)
      VALUES (?, ?, 'delete', ?, ?)
    `).run(uuidv4(), sessionId, JSON.stringify({ pages: toDelete }), now)

    db.prepare('UPDATE page_management_sessions SET updated_at=? WHERE id=?').run(now, sessionId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return { deletedPages: toDelete, remainingPageCount: activeSet.size - toDelete.length }
}

// ── Extract ───────────────────────────────────────────────────────────────────

export async function createExtractionJob(
  sessionId: string,
  selectionSpec: string,
  destinationPath: string,
  outputFormat: OutputFormat = 'pdf',
  includeRotations = true,
  preserveOrder = true,
): Promise<ExtractionJob> {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) throw new Error('SESSION_NOT_FOUND')

  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO extraction_jobs
      (id, session_id, selection_spec, include_rotations, preserve_order, output_format,
       destination_path, status, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(id, sessionId, selectionSpec, includeRotations ? 1 : 0, preserveOrder ? 1 : 0, outputFormat, destinationPath, now)

  return getExtractionJob(id)!
}

export function getExtractionJob(jobId: string): ExtractionJob | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM extraction_jobs WHERE id=?').get(jobId) as Record<string, unknown> | undefined
  return row ? mapExtractionJob(row) : null
}

export async function runExtractionJob(jobId: string, sourcePdfPath: string): Promise<void> {
  const db = getDb()
  const job = getExtractionJob(jobId)
  if (!job) throw new Error('EXTRACTION_JOB_NOT_FOUND')

  db.prepare('UPDATE extraction_jobs SET status=\'running\', started_at=? WHERE id=?').run(new Date().toISOString(), jobId)

  try {
    const pages = getSessionPages(job.sessionId)
    const selected = parseSelectionSpec(job.selectionSpec, pages)

    const sourceBytes = fs.readFileSync(sourcePdfPath)
    const srcDoc = await PDFDocument.load(sourceBytes)
    const newDoc = await PDFDocument.create()

    const orderedSelected = job.preserveOrder
      ? selected.sort((a, b) => a.currentOrderIndex - b.currentOrderIndex)
      : selected

    const pagesToCopy = orderedSelected.map((p) => p.originalPageNumber - 1)
    const copiedPages = await newDoc.copyPages(srcDoc, pagesToCopy)

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i]
      if (job.includeRotations && orderedSelected[i].rotationDeg !== 0) {
        page.setRotation(degrees(orderedSelected[i].rotationDeg))
      }
      newDoc.addPage(page)
    }

    const pdfBytes = await newDoc.save()
    const destPath = job.destinationPath ?? `extracted_${jobId}.pdf`
    fs.writeFileSync(destPath, pdfBytes)

    db.prepare('UPDATE extraction_jobs SET status=\'completed\', finished_at=?, page_count=?, result_file_path=? WHERE id=?')
      .run(new Date().toISOString(), pagesToCopy.length, destPath, jobId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare('UPDATE extraction_jobs SET status=\'failed\', finished_at=?, error_message=? WHERE id=?')
      .run(new Date().toISOString(), msg, jobId)
    throw err
  }
}

// ── Undo ──────────────────────────────────────────────────────────────────────

export function undoLastAction(sessionId: string): boolean {
  const db = getDb()
  const action = db.prepare(
    `SELECT * FROM session_actions WHERE session_id=? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`,
  ).get(sessionId) as Record<string, unknown> | undefined

  if (!action) return false

  const now = new Date().toISOString()
  const payload = JSON.parse(action.payload as string) as Record<string, unknown>
  const type = action.action_type as string

  db.exec('BEGIN')
  try {
    if (type === 'rotate') {
      const prev = payload.prev as Record<number, number>
      for (const [pageNum, rotation] of Object.entries(prev)) {
        db.prepare('UPDATE session_pages SET rotation_deg=?, updated_at=? WHERE session_id=? AND original_page_number=?')
          .run(rotation, now, sessionId, Number(pageNum))
      }
    } else if (type === 'delete') {
      const pages = payload.pages as number[]
      for (const p of pages) {
        db.prepare('UPDATE session_pages SET is_deleted=0, updated_at=? WHERE session_id=? AND original_page_number=?')
          .run(now, sessionId, p)
      }
    }

    db.prepare('UPDATE session_actions SET undone_at=? WHERE id=?').run(now, action.id as string)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  return true
}

// ── Apply session to document ─────────────────────────────────────────────────

export function applySessionToDocument(sessionId: string): void {
  const db = getDb()
  const session = getSession(sessionId)
  if (!session) throw new Error('SESSION_NOT_FOUND')

  const pages = getSessionPages(sessionId)
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    for (const page of pages) {
      db.prepare(`
        INSERT INTO document_page_overrides
          (id, document_id, document_version_id, page_number, order_index, rotation_deg, is_deleted, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, document_version_id, page_number) DO UPDATE SET
          order_index=excluded.order_index,
          rotation_deg=excluded.rotation_deg,
          is_deleted=excluded.is_deleted,
          updated_at=excluded.updated_at
      `).run(
        uuidv4(), session.documentId, session.documentVersionId as string | null,
        page.originalPageNumber, page.currentOrderIndex,
        page.rotationDeg, page.isDeleted ? 1 : 0, now,
      )
    }
    db.prepare('UPDATE page_management_sessions SET status=\'applied\', updated_at=? WHERE id=?').run(now, sessionId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function getDocumentPageOverrides(
  documentId: string,
  documentVersionId?: string,
): Array<{ pageNumber: number; orderIndex: number; rotationDeg: number; isDeleted: boolean }> {
  const db = getDb()
  const rows = db.prepare(
    `SELECT * FROM document_page_overrides
     WHERE document_id=? AND (document_version_id IS ? OR document_version_id IS NULL)
     ORDER BY order_index`,
  ).all(documentId, documentVersionId ?? null) as Array<Record<string, unknown>>

  return rows.map((r) => ({
    pageNumber: r.page_number as number,
    orderIndex: r.order_index as number,
    rotationDeg: r.rotation_deg as number,
    isDeleted: Boolean(r.is_deleted),
  }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseSelectionSpec(spec: string, pages: SessionPage[]): SessionPage[] {
  if (spec === 'all') return pages.filter((p) => !p.isDeleted)

  const activeMap = new Map(pages.filter((p) => !p.isDeleted).map((p) => [p.originalPageNumber, p]))
  const selected: SessionPage[] = []

  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      for (let n = parseInt(rangeMatch[1], 10); n <= parseInt(rangeMatch[2], 10); n++) {
        const p = activeMap.get(n)
        if (p) selected.push(p)
      }
    } else {
      const p = activeMap.get(parseInt(trimmed, 10))
      if (p) selected.push(p)
    }
  }

  return selected
}

function mapSession(row: Record<string, unknown>): PageManagementSession {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    documentVersionId: (row.document_version_id as string | null) ?? null,
    status: row.status as PageManagementSession['status'],
    sourcePageCount: row.source_page_count as number,
    sourceContentHash: row.source_content_hash as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function mapSessionPage(row: Record<string, unknown>): SessionPage {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    originalPageNumber: row.original_page_number as number,
    currentOrderIndex: row.current_order_index as number,
    rotationDeg: row.rotation_deg as RotationDeg,
    isDeleted: Boolean(row.is_deleted),
    updatedAt: row.updated_at as string,
  }
}

function mapExtractionJob(row: Record<string, unknown>): ExtractionJob {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    selectionSpec: row.selection_spec as string,
    includeRotations: Boolean(row.include_rotations),
    preserveOrder: Boolean(row.preserve_order),
    outputFormat: row.output_format as OutputFormat,
    destinationPath: (row.destination_path as string | null) ?? null,
    status: row.status as ExtractionJob['status'],
    requestedAt: row.requested_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    finishedAt: (row.finished_at as string | null) ?? null,
    pageCount: (row.page_count as number | null) ?? null,
    resultFilePath: (row.result_file_path as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
  }
}
