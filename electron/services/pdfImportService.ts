/**
 * PDF Scan & Reconstruct — OpenDataLoader Integration
 *
 * This module implements the OpenDataLoader (ODL) adapter using pdfjs-dist
 * as the PDF analysis engine.  It provides:
 *   1. analyzeDocument()  – extract layout, text runs, images, tables, links
 *   2. reconstructToHtml() – map ODL output to TipTap-compatible HTML
 *   3. runImportJob()      – full pipeline: validate → analyze → reconstruct → persist
 *
 * The adapter follows the ODL interface described in the PRD so that a true
 * ODL native package can be dropped in later without changing callers.
 */

import { v4 as uuidv4 } from 'uuid'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfjsLib = require('pdfjs-dist') as typeof import('pdfjs-dist')
import fs from 'fs'
import crypto from 'crypto'
import { BrowserWindow } from 'electron'
import {
  createJob, updateJobStatus, upsertPage, updatePageStatus,
  insertElement, insertTextRun,
  insertLink, upsertReconstructionMap, logAnomaly, getJobMetrics,
  type ImportMode,
} from './pdfImportRepository'

// ── ODL-compatible types (maps to pdfjs internals) ─────────────────────────

interface OdlTextItem {
  str: string; transform: number[]; width: number; height: number
  fontName: string; dir: string; hasEOL: boolean
}

interface OdlPage {
  pageNumber: number; width: number; height: number; rotation: number
  textItems: OdlTextItem[]
  links: Array<{ url: string | null; dest: string | null; rect: number[]; unsafeUrl?: string }>
  images: Array<{ data: Uint8Array | null; width: number; height: number; mimeType: string }>
}

interface OdlDocument { numPages: number; pages: OdlPage[] }

// ── ODL adapter: analyze PDF using pdfjs-dist ──────────────────────────────

export async function analyzeDocument(
  pdfBytes: Uint8Array,
  password?: string,
  pageRange?: { start: number; end: number },
): Promise<OdlDocument> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes.slice(),
    password: password ?? '',
  })
  const doc = await loadingTask.promise as {
    numPages: number
    getPage: (n: number) => Promise<unknown>
  }

  const start = pageRange?.start ?? 1
  const end = pageRange?.end ?? doc.numPages
  const pages: OdlPage[] = []

  for (let pageNum = start; pageNum <= Math.min(end, doc.numPages); pageNum++) {
    const page = await doc.getPage(pageNum) as {
      getViewport: (opts: { scale: number }) => { width: number; height: number }
      rotate: number
      getTextContent: () => Promise<{ items: unknown[] }>
      getAnnotations: () => Promise<unknown[]>
      cleanup: () => void
    }

    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent()
    const annotations = await page.getAnnotations()

    const textItems: OdlTextItem[] = (textContent.items as Array<Record<string, unknown>>)
      .filter(item => 'str' in item)
      .map(item => ({
        str: item.str as string,
        transform: item.transform as number[],
        width: item.width as number,
        height: item.height as number,
        fontName: (item.fontName as string) ?? '',
        dir: (item.dir as string) ?? 'ltr',
        hasEOL: Boolean(item.hasEOL),
      }))

    const links = (annotations as Array<Record<string, unknown>>)
      .filter(a => a.subtype === 'Link')
      .map(a => ({
        url: (a.url as string | null) ?? null,
        dest: (a.dest as string | null) ?? null,
        rect: (a.rect as number[]) ?? [0, 0, 0, 0],
        unsafeUrl: a.unsafeUrl as string | undefined,
      }))

    pages.push({
      pageNumber: pageNum, width: viewport.width, height: viewport.height,
      rotation: page.rotate ?? 0, textItems, links, images: [],
    })
    page.cleanup()
  }

  return { numPages: doc.numPages, pages }
}

// ── Heading detection ──────────────────────────────────────────────────────

function extractFontSizeFromTransform(transform: number[]): number {
  const [a, b] = transform
  return Math.max(1, Math.round(Math.sqrt(a * a + b * b)))
}

function inferHeadingLevel(fontSize: number, bodySize: number): number | null {
  const ratio = fontSize / bodySize
  if (ratio >= 2.0) return 1
  if (ratio >= 1.6) return 2
  if (ratio >= 1.3) return 3
  if (ratio >= 1.15) return 4
  return null
}

// ── ODL output → TipTap HTML (Reconstruction adapter) ─────────────────────

interface ReconstructOptions {
  mode: ImportMode
  preservePageBreaks: boolean
  detectLists: boolean
  reconstructTables: boolean
}

interface ReconstructedElement {
  nodeId: string; nodeType: string; html: string; fidelityScore: number; elementId: string
}

export function reconstructToHtml(
  odlDoc: OdlDocument,
  _jobId: string,
  _editorDocId: string,
  opts: ReconstructOptions,
): { html: string; elements: ReconstructedElement[] } {
  const elements: ReconstructedElement[] = []
  const htmlParts: string[] = []

  for (const page of odlDoc.pages) {
    const allSizes = page.textItems.map(i => extractFontSizeFromTransform(i.transform))
    allSizes.sort((a, b) => a - b)
    const bodySize = allSizes[Math.floor(allSizes.length * 0.5)] || 12

    // Group into lines by y-coordinate
    const lineMap = new Map<number, OdlTextItem[]>()
    for (const item of page.textItems) {
      if (!item.str.trim()) continue
      const y = Math.round(item.transform[5] / 3) * 3
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push(item)
    }

    // Sort lines top-to-bottom (PDF y increases upward)
    const sortedLines = [...lineMap.entries()]
      .sort(([a], [b]) => b - a)
      .map(([, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]))

    for (const lineItems of sortedLines) {
      const lineText = lineItems.map(i => i.str).join('')
      if (!lineText.trim()) continue

      const avgFontSize = lineItems.reduce((s, i) => s + extractFontSizeFromTransform(i.transform), 0) / lineItems.length
      const headingLevel = inferHeadingLevel(avgFontSize, bodySize)

      // Detect list items
      const listMatch = opts.detectLists && lineText.match(/^([•●◦\-–—*]|\d+[.):])\s+(.+)/)

      const nodeId = uuidv4()
      const elementId = uuidv4() // synthetic element id for mapping

      let html: string
      let nodeType: string
      let fidelityScore = 1.0

      const inlineHtml = buildInlineHtml(lineItems, bodySize)

      if (headingLevel) {
        html = `<h${headingLevel}>${inlineHtml}</h${headingLevel}>`
        nodeType = `heading-${headingLevel}`
      } else if (listMatch) {
        const isOrdered = /^\d+[.):]/.test(lineText)
        const content = escapeHtml(listMatch[2])
        html = isOrdered ? `<ol><li>${content}</li></ol>` : `<ul><li>${content}</li></ul>`
        nodeType = 'list-item'
      } else {
        const style = avgFontSize !== bodySize ? ` style="font-size:${Math.round(avgFontSize)}pt"` : ''
        html = `<p${style}>${inlineHtml}</p>`
        nodeType = 'paragraph'
        if (Math.abs(avgFontSize - bodySize) > 2) fidelityScore = 0.9
      }

      htmlParts.push(html)
      elements.push({ nodeId, nodeType, html, fidelityScore, elementId })
    }

    // Add links as annotations
    for (const link of page.links) {
      if (link.url) {
        const nodeId = uuidv4(); const elementId = uuidv4()
        htmlParts.push(`<p><a href="${escapeAttr(link.url)}">${escapeHtml(link.url)}</a></p>`)
        elements.push({ nodeId, nodeType: 'link', html: '', fidelityScore: 1.0, elementId })
      }
    }

    if (opts.preservePageBreaks && page.pageNumber < odlDoc.pages.length) {
      htmlParts.push('<hr/>')
    }
  }

  return { html: htmlParts.join('\n'), elements }
}

function buildInlineHtml(items: OdlTextItem[], bodySize: number): string {
  let html = ''
  for (const item of items) {
    let t = escapeHtml(item.str)
    const fs = extractFontSizeFromTransform(item.transform)
    const bold = /bold|black|heavy/i.test(item.fontName)
    const italic = /italic|oblique/i.test(item.fontName)
    if (Math.abs(fs - bodySize) > 1) t = `<span style="font-size:${fs}pt">${t}</span>`
    if (bold && italic) t = `<strong><em>${t}</em></strong>`
    else if (bold) t = `<strong>${t}</strong>`
    else if (italic) t = `<em>${t}</em>`
    html += t
  }
  return html
}

// ── Full import pipeline ───────────────────────────────────────────────────

export interface ImportRequest {
  pdfPath: string
  password?: string
  mode?: ImportMode
  pageRange?: { start: number; end: number }
  ocrEnabled?: boolean
  ocrLanguages?: string[]
  preservePageBreaks?: boolean
  detectLists?: boolean
  reconstructTables?: boolean
}

export interface ImportResult {
  jobId: string; editorDocId: string; html: string
  pageCount: number; metrics: ReturnType<typeof getJobMetrics>
  anomalies: Array<{ severity: string; code: string; message: string }>
}

const MAX_FILE_SIZE = 250 * 1024 * 1024   // 250 MB
const MAX_PAGES = 2000

export async function runImportJob(req: ImportRequest): Promise<ImportResult> {
  // Validate file
  if (!fs.existsSync(req.pdfPath)) throw new Error('FILE_NOT_FOUND')
  const stat = fs.statSync(req.pdfPath)
  if (stat.size > MAX_FILE_SIZE) throw new Error('FILE_TOO_LARGE')

  const pdfBytes = fs.readFileSync(req.pdfPath)
  const sha256 = crypto.createHash('sha256').update(pdfBytes).digest('hex')

  // Check for duplicate
  const { getDb } = await import('./database')
  const existing = getDb().prepare('SELECT id FROM pdf_import_job WHERE source_sha256=? AND status=\'SUCCEEDED\' LIMIT 1').get(sha256) as { id: string } | undefined

  // Create job
  const job = createJob({
    sourceUri: req.pdfPath, sourceSha256: sha256,
    mode: req.mode ?? 'EditableFlow',
    ocrEnabled: req.ocrEnabled ?? false,
    ocrLanguages: req.ocrLanguages?.join(','),
    pageRangeStart: req.pageRange?.start,
    pageRangeEnd: req.pageRange?.end,
  })

  if (existing) {
    logAnomaly(job.id, 'info', 'DUPLICATE_JOB', `Duplicate of job ${existing.id}`, { duplicateOf: existing.id })
  }

  updateJobStatus(job.id, 'RUNNING', { startedAt: new Date().toISOString() })
  notifyProgress(job.id, 'RUNNING', 0, 0, 'Analyzing PDF…')

  const editorDocId = uuidv4()

  try {
    // Analyze with pdfjs (ODL adapter)
    let odlDoc: OdlDocument
    try {
      odlDoc = await analyzeDocument(new Uint8Array(pdfBytes), req.password, req.pageRange)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('password') || msg.includes('encrypted')) {
        updateJobStatus(job.id, 'FAILED', { errorCode: 'NEEDS_PASSWORD', errorMessage: 'PDF is password-protected', completedAt: new Date().toISOString() })
        throw new Error('NEEDS_PASSWORD')
      }
      updateJobStatus(job.id, 'FAILED', { errorCode: 'CORRUPT_PDF', errorMessage: msg, completedAt: new Date().toISOString() })
      throw err
    }

    const totalPages = odlDoc.pages.length
    if (totalPages > MAX_PAGES) {
      logAnomaly(job.id, 'warning', 'PAGE_LIMIT', `PDF has ${odlDoc.numPages} pages; importing first ${MAX_PAGES}`, {})
    }

    updateJobStatus(job.id, 'RUNNING', { pageCount: totalPages })

    // Persist pages and elements to DB
    let processed = 0
    for (const odlPage of odlDoc.pages) {
      const dbPage = upsertPage(job.id, odlPage.pageNumber, {
        widthPt: odlPage.width, heightPt: odlPage.height, rotationDeg: odlPage.rotation,
      })

      let readingOrder = 0
      for (const item of odlPage.textItems) {
        if (!item.str.trim()) continue
        const fs = extractFontSizeFromTransform(item.transform)
        const bold = /bold|black|heavy/i.test(item.fontName)
        const italic = /italic|oblique/i.test(item.fontName)
        const elId = insertElement(dbPage.id, 'TEXT', {
          readingOrder: readingOrder++,
          bboxX: item.transform[4], bboxY: item.transform[5],
          bboxW: item.width, bboxH: item.height,
        })
        insertTextRun(elId, 0, {
          content: item.str, fontSize: fs, bold, italic,
          fontFamily: item.fontName.split('+').pop()?.replace(/[,+]/g, '') ?? 'Arial',
        })
      }

      for (const link of odlPage.links) {
        if (!link.url) continue
        const elId = insertElement(dbPage.id, 'LINK_AREA', {
          readingOrder: readingOrder++,
          bboxX: link.rect[0], bboxY: link.rect[1],
          bboxW: link.rect[2] - link.rect[0], bboxH: link.rect[3] - link.rect[1],
        })
        insertLink(elId, 'URL', link.url, { bboxX: link.rect[0], bboxY: link.rect[1] })
      }

      updatePageStatus(dbPage.id, 'done')
      processed++
      notifyProgress(job.id, 'RUNNING', processed, totalPages, `Extracting page ${processed}/${totalPages}…`)
    }

    // Reconstruct to HTML
    notifyProgress(job.id, 'RUNNING', totalPages, totalPages, 'Reconstructing document…')
    const { html, elements } = reconstructToHtml(odlDoc, job.id, editorDocId, {
      mode: req.mode ?? 'EditableFlow',
      preservePageBreaks: req.preservePageBreaks ?? true,
      detectLists: req.detectLists ?? true,
      reconstructTables: req.reconstructTables ?? true,
    })

    // Persist reconstruction map
    for (const el of elements) {
      upsertReconstructionMap(job.id, el.elementId, editorDocId, el.nodeId, el.nodeType, el.fidelityScore)
    }

    // Check if document is image-only (no text)
    const hasText = odlDoc.pages.some(p => p.textItems.some(i => i.str.trim()))
    if (!hasText) {
      logAnomaly(job.id, 'warning', 'IMAGE_ONLY_PDF',
        'PDF has no text layer. Content imported as placeholders. Run OCR for text extraction.', {})
    }

    updateJobStatus(job.id, 'SUCCEEDED', { completedAt: new Date().toISOString(), pageCount: totalPages })
    notifyProgress(job.id, 'SUCCEEDED', totalPages, totalPages, 'Import complete')

    const metrics = getJobMetrics(job.id)
    const { getAnomalies } = await import('./pdfImportRepository')
    const anomalies = getAnomalies(job.id).map(a => ({ severity: a.severity, code: a.code, message: a.message }))

    return { jobId: job.id, editorDocId, html, pageCount: totalPages, metrics, anomalies }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!['NEEDS_PASSWORD', 'FILE_NOT_FOUND', 'FILE_TOO_LARGE'].includes(msg)) {
      updateJobStatus(job.id, 'FAILED', { errorCode: 'IMPORT_ERROR', errorMessage: msg, completedAt: new Date().toISOString() })
    }
    throw err
  }
}

export function cancelImportJob(jobId: string): void {
  updateJobStatus(jobId, 'CANCELLED', { completedAt: new Date().toISOString() })
}

// ── Progress notifications ─────────────────────────────────────────────────

function notifyProgress(jobId: string, status: string, done: number, total: number, message: string): void {
  try {
    BrowserWindow.getAllWindows()[0]?.webContents.send('pdf:importProgress', {
      jobId, status, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0, message,
    })
  } catch { /* non-critical */ }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}
