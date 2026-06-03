import { v4 as uuidv4 } from 'uuid'
import { createWorker, type Worker as TesseractWorker } from 'tesseract.js'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app, BrowserWindow } from 'electron'
import { getDb } from './database'
import type {
  OcrJob,
  OcrPage,
  OcrBlock,
  CreateOcrJobRequest,
  OcrJobProgress,
} from '../../src/types'

const MAX_CONCURRENT_JOBS = 2
const DPI = 150

let runningJobs = 0
const jobQueue: string[] = []

// ── Public API ────────────────────────────────────────────────────────────────

export function createOcrJob(req: CreateOcrJobRequest): OcrJob {
  validateOcrRequest(req)

  const db = getDb()
  const sha256 = hashFile(req.pdfPath)
  const pageCount = getPdfPageCount(req.pdfPath)
  const languages = (req.languages ?? ['eng']).join(',')
  const priority = req.priority === 'low' ? 3 : 5

  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO ocr_jobs
      (id, source_pdf_uri, source_pdf_sha256, page_count, requested_languages,
       status, priority, target_document_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
  `).run(id, req.pdfPath, sha256, pageCount, languages, priority, req.targetDocumentId ?? null, now, now)

  db.exec('BEGIN')
  try {
    const insertPage = db.prepare(
      'INSERT INTO ocr_pages (id, job_id, page_number, status, created_at, updated_at) VALUES (?, ?, ?, \'queued\', ?, ?)',
    )
    for (let i = 1; i <= pageCount; i++) {
      insertPage.run(uuidv4(), id, i, now, now)
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  jobQueue.push(id)
  setImmediate(() => drainQueue())

  return getOcrJob(id)!
}

export function getOcrJob(jobId: string): OcrJob | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM ocr_jobs WHERE id=?').get(jobId) as Record<string, unknown> | undefined
  return row ? mapOcrJob(row) : null
}

export function getOcrJobProgress(jobId: string): OcrJobProgress | null {
  const db = getDb()
  const job = getOcrJob(jobId)
  if (!job) return null

  const pages = db.prepare(
    'SELECT page_number, status, updated_at FROM ocr_pages WHERE job_id=? ORDER BY page_number',
  ).all(jobId) as Array<{ page_number: number; status: string; updated_at: string }>

  const pagesProcessed = pages.filter(
    (p) => ['completed', 'failed', 'skipped'].includes(p.status),
  ).length

  return {
    jobId,
    status: job.status,
    progress: { pagesTotal: job.pageCount, pagesProcessed },
    perPage: pages.map((p) => ({ page: p.page_number, status: p.status, error: null })),
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    error: job.errorMessage,
  }
}

export function cancelOcrJob(jobId: string): boolean {
  const db = getDb()
  const job = getOcrJob(jobId)
  if (!job) return false
  if (['completed', 'failed', 'canceled'].includes(job.status)) return false

  db.prepare('UPDATE ocr_jobs SET status=\'canceled\', updated_at=datetime(\'now\') WHERE id=?').run(jobId)
  db.prepare(
    'UPDATE ocr_pages SET status=\'failed\', updated_at=datetime(\'now\') WHERE job_id=? AND status IN (\'queued\',\'processing\')',
  ).run(jobId)
  return true
}

export function getOcrResult(jobId: string): {
  jobId: string
  pages: Array<{ page: number; dpi: number; rotation: number; blocks: OcrBlock[]; plainText: string; hadExistingText: boolean }>
  meta: { languagesUsed: string[]; autoDetected: boolean }
} | null {
  const db = getDb()
  const job = getOcrJob(jobId)
  if (!job || job.status === 'queued' || job.status === 'running') return null

  const pages = db.prepare(
    'SELECT * FROM ocr_pages WHERE job_id=? AND status=\'completed\' ORDER BY page_number',
  ).all(jobId) as Array<Record<string, unknown>>

  const resultPages = pages.map((p) => {
    const blocks = db.prepare('SELECT * FROM ocr_blocks WHERE page_id=? ORDER BY seq').all(p.id as string) as Array<Record<string, unknown>>
    return {
      page: p.page_number as number,
      dpi: (p.dpi as number) ?? DPI,
      rotation: (p.rotation_deg as number) ?? 0,
      blocks: blocks.map(mapOcrBlock),
      plainText: (p.text_full as string) ?? '',
      hadExistingText: false,
    }
  })

  return {
    jobId,
    pages: resultPages,
    meta: {
      languagesUsed: job.requestedLanguages.split(','),
      autoDetected: job.requestedLanguages === 'auto',
    },
  }
}

export function getInstalledLanguages(): Array<{ code: string; name: string }> {
  const langMap: Record<string, string> = {
    eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian',
    por: 'Portuguese', rus: 'Russian', chi_sim: 'Chinese (Simplified)',
    chi_tra: 'Chinese (Traditional)', jpn: 'Japanese', kor: 'Korean', ara: 'Arabic',
    hin: 'Hindi', nld: 'Dutch', pol: 'Polish', swe: 'Swedish', nor: 'Norwegian',
    dan: 'Danish', fin: 'Finnish', tur: 'Turkish',
  }
  return Object.entries(langMap).map(([code, name]) => ({ code, name }))
}

export function mergeOcrTextToDocument(jobId: string, targetDocumentId: string): { pagesMerged: number; wordCount: number } {
  const db = getDb()
  const pages = db.prepare(
    'SELECT id, page_number, text_full FROM ocr_pages WHERE job_id=? AND status=\'completed\'',
  ).all(jobId) as Array<{ id: string; page_number: number; text_full: string }>

  let wordCount = 0
  for (const page of pages) {
    wordCount += (page.text_full ?? '').split(/\s+/).filter(Boolean).length
  }

  db.prepare('UPDATE ocr_jobs SET target_document_id=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(targetDocumentId, jobId)

  return { pagesMerged: pages.length, wordCount }
}

// ── Queue management ──────────────────────────────────────────────────────────

function drainQueue(): void {
  while (runningJobs < MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const jobId = jobQueue.shift()!
    runningJobs++
    processJob(jobId).finally(() => {
      runningJobs--
      drainQueue()
    })
  }
}

async function processJob(jobId: string): Promise<void> {
  // Guard against DB being closed (e.g., test teardown fires setImmediate late)
  let db
  try {
    db = getDb()
  } catch {
    return
  }

  let job: OcrJob | null
  try {
    job = getOcrJob(jobId)
  } catch {
    return
  }
  if (!job || job.status === 'canceled') return

  const now = new Date().toISOString()
  try {
    db.prepare('UPDATE ocr_jobs SET status=\'running\', started_at=?, updated_at=? WHERE id=?').run(now, now, jobId)
  } catch {
    return
  }

  const tempDir = path.join(app.getPath('temp'), `ocr_${jobId}`)
  fs.mkdirSync(tempDir, { recursive: true })

  let worker: TesseractWorker | null = null

  try {
    const languages = job.requestedLanguages === 'auto' ? 'eng' : job.requestedLanguages.replace(/,/g, '+')
    worker = await createWorker(languages)

    const pageNums = db.prepare(
      'SELECT id, page_number FROM ocr_pages WHERE job_id=? AND status=\'queued\' ORDER BY page_number',
    ).all(jobId) as Array<{ id: string; page_number: number }>

    // Dynamically import pdfjs (ESM) for rendering
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js' as string)
    const pdfData = new Uint8Array(fs.readFileSync(job.sourcePdfUri))
    const pdfDoc = await (pdfjsLib as unknown as { getDocument: (opts: unknown) => { promise: Promise<unknown> } })
      .getDocument({ data: pdfData }).promise as {
        getPage: (n: number) => Promise<{
          getViewport: (opts: { scale: number }) => { width: number; height: number }
          render: (opts: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> }
        }>
      }

    for (const { id: pageId, page_number: pageNum } of pageNums) {
      const currentStatus = (db.prepare('SELECT status FROM ocr_jobs WHERE id=?').get(jobId) as { status: string } | undefined)?.status
      if (currentStatus === 'canceled') break

      db.prepare('UPDATE ocr_pages SET status=\'processing\', updated_at=? WHERE id=?').run(new Date().toISOString(), pageId)

      try {
        const page = await pdfDoc.getPage(pageNum)
        const viewport = page.getViewport({ scale: DPI / 72 })

        // Use canvas to render the page
        // @ts-ignore: canvas types not installed; loaded at runtime only
        const { createCanvas } = await import('canvas')
        const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height))
        const context = canvas.getContext('2d')

        await page.render({ canvasContext: context as unknown, viewport }).promise

        const imagePath = path.join(tempDir, `page_${pageNum}.png`)
        fs.writeFileSync(imagePath, canvas.toBuffer('image/png'))

        const result = await worker.recognize(imagePath)
        const text = result.data.text
        const confPpm = Math.round((result.data.confidence / 100) * 1000)

        let seq = 0
        db.exec('BEGIN')
        try {
          const insertBlock = db.prepare(
            'INSERT INTO ocr_blocks (id, page_id, kind, seq, bbox_x, bbox_y, bbox_w, bbox_h, text, lang, confidence_ppm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          for (const block of (result.data as { blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: Array<{ bbox: { x0: number; y0: number; x1: number; y1: number }; text: string; confidence: number }> }> }> }> }).blocks ?? []) {
            for (const para of block.paragraphs ?? []) {
              for (const line of para.lines ?? []) {
                for (const word of line.words ?? []) {
                  insertBlock.run(
                    uuidv4(), pageId, 'word', seq++,
                    Math.round(word.bbox.x0), Math.round(word.bbox.y0),
                    Math.round(word.bbox.x1 - word.bbox.x0), Math.round(word.bbox.y1 - word.bbox.y0),
                    word.text, languages.split('+')[0],
                    Math.round((word.confidence / 100) * 1000),
                  )
                }
              }
            }
          }
          db.exec('COMMIT')
        } catch (e) {
          db.exec('ROLLBACK')
        }

        db.prepare(`
          UPDATE ocr_pages
          SET status='completed', text_full=?, confidence_avg_ppm=?,
              dpi=?, width_px=?, height_px=?, image_uri=?, updated_at=?
          WHERE id=?
        `).run(text, confPpm, DPI, Math.round(viewport.width), Math.round(viewport.height), imagePath, new Date().toISOString(), pageId)

        notifyProgress(jobId)
      } catch {
        db.prepare('UPDATE ocr_pages SET status=\'failed\', updated_at=? WHERE id=?').run(new Date().toISOString(), pageId)
      }
    }

    const { c: failedCount } = db.prepare(
      'SELECT COUNT(*) as c FROM ocr_pages WHERE job_id=? AND status=\'failed\'',
    ).get(jobId) as { c: number }

    const finalStatus = failedCount > 0 ? 'partial' : 'completed'
    db.prepare('UPDATE ocr_jobs SET status=?, completed_at=?, updated_at=? WHERE id=?')
      .run(finalStatus, new Date().toISOString(), new Date().toISOString(), jobId)

    notifyProgress(jobId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    db.prepare('UPDATE ocr_jobs SET status=\'failed\', error_message=?, completed_at=?, updated_at=? WHERE id=?')
      .run(msg, new Date().toISOString(), new Date().toISOString(), jobId)
  } finally {
    worker?.terminate()
    setTimeout(() => fs.rmSync(tempDir, { recursive: true, force: true }), 60_000)
  }
}

function notifyProgress(jobId: string): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  const progress = getOcrJobProgress(jobId)
  win.webContents.send('ocr:progress', progress)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function getPdfPageCount(filePath: string): number {
  const data = fs.readFileSync(filePath).toString('latin1')
  const countMatch = data.match(/\/Count\s+(\d+)/)
  if (countMatch) return parseInt(countMatch[1], 10)
  const pageMatches = data.match(/\/Type\s*\/Page[^s]/g)
  return pageMatches ? pageMatches.length : 1
}

function validateOcrRequest(req: CreateOcrJobRequest): void {
  if (!fs.existsSync(req.pdfPath)) throw new Error('PDF_NOT_FOUND')
  if (fs.statSync(req.pdfPath).size > 500 * 1024 * 1024) throw new Error('PDF_TOO_LARGE')
}

function mapOcrJob(row: Record<string, unknown>): OcrJob {
  return {
    id: row.id as string,
    sourcePdfUri: row.source_pdf_uri as string,
    sourcePdfSha256: row.source_pdf_sha256 as string,
    pageCount: row.page_count as number,
    requestedLanguages: row.requested_languages as string,
    ocrEngine: row.ocr_engine as string,
    status: row.status as OcrJob['status'],
    priority: row.priority as number,
    targetDocumentId: (row.target_document_id as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: row.created_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  }
}

function mapOcrBlock(row: Record<string, unknown>): OcrBlock {
  return {
    id: row.id as string,
    pageId: row.page_id as string,
    kind: row.kind as OcrBlock['kind'],
    seq: row.seq as number,
    bboxX: row.bbox_x as number,
    bboxY: row.bbox_y as number,
    bboxW: row.bbox_w as number,
    bboxH: row.bbox_h as number,
    text: row.text as string,
    lang: (row.lang as string | null) ?? null,
    confidencePpm: (row.confidence_ppm as number | null) ?? null,
  }
}

// Keep OcrPage in scope for future use
void (null as unknown as OcrPage)
