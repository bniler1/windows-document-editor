/**
 * PDF Scan & Reconstruct — fidelity + round-trip tests
 * pdfjs-dist is mocked (ESM-only, can't run in Jest).
 * Tests cover: repository CRUD, reconstructToHtml logic,
 * pipeline orchestration, anomaly logging, metrics, performance.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { jest } from '@jest/globals'

// ── Mocks ─────────────────────────────────────────────────────

jest.mock('electron', () => ({
  app: { getPath: (_: string) => os.tmpdir(), isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: jest.fn() }, dialog: {},
}))

// Mock pdfjs-dist so we don't need the ESM build in Jest
jest.mock('pdfjs-dist', () => ({
  getDocument: jest.fn().mockReturnValue({
    promise: Promise.resolve({
      numPages: 2,
      getPage: jest.fn().mockResolvedValue({
        getViewport: () => ({ width: 612, height: 792 }),
        rotate: 0,
        getTextContent: () => Promise.resolve({
          items: [
            { str: 'Hello World', transform: [12, 0, 0, 12, 50, 700], width: 80, height: 12, fontName: 'Helvetica', dir: 'ltr', hasEOL: false },
            { str: 'Second line', transform: [12, 0, 0, 12, 50, 680], width: 75, height: 12, fontName: 'Helvetica', dir: 'ltr', hasEOL: false },
            { str: 'Big Heading Text', transform: [28, 0, 0, 28, 50, 750], width: 200, height: 28, fontName: 'Helvetica-Bold', dir: 'ltr', hasEOL: false },
            { str: '• Bullet item one', transform: [12, 0, 0, 12, 50, 660], width: 100, height: 12, fontName: 'Helvetica', dir: 'ltr', hasEOL: false },
            { str: '1. Numbered item', transform: [12, 0, 0, 12, 50, 640], width: 100, height: 12, fontName: 'Helvetica', dir: 'ltr', hasEOL: false },
          ],
        }),
        getAnnotations: () => Promise.resolve([
          { subtype: 'Link', url: 'https://example.com', dest: null, rect: [50, 600, 200, 620] },
        ]),
        cleanup: jest.fn(),
      }),
    }),
  }),
}))

import * as dbModule from '../electron/services/database'
import {
  createJob, getJob, updateJobStatus, listJobs, deleteJob,
  upsertPage, getPagesByJob, updatePageStatus,
  insertElement, getElementsByPage,
  insertTextRun, getTextRunsByElement,
  insertTable, insertTableCell, getTableCells,
  insertLink,
  upsertReconstructionMap, getReconstructionMap,
  logAnomaly, getAnomalies,
  getJobMetrics,
  createExportArtifact, updateExportArtifact,
} from '../electron/services/pdfImportRepository'
import { analyzeDocument, reconstructToHtml } from '../electron/services/pdfImportService'

const TMP = os.tmpdir()
let testDb: DatabaseSync

beforeAll(() => {
  testDb = new DatabaseSync(':memory:')
  testDb.exec('PRAGMA foreign_keys=ON')
  const migsDir = path.join(__dirname, '..', 'db', 'migrations')
  for (const f of fs.readdirSync(migsDir).sort()) {
    if (f.endsWith('.sql')) testDb.exec(fs.readFileSync(path.join(migsDir, f), 'utf-8'))
  }
  Object.defineProperty(dbModule, 'getDb', { value: () => testDb, writable: true })
})

afterAll(() => testDb.close())

// ── Repository — Job lifecycle ────────────────────────────────

describe('Repository — job lifecycle', () => {
  test('create and retrieve job', () => {
    const job = createJob({ sourceUri: '/test.pdf', sourceSha256: 'abc123' })
    expect(job.status).toBe('QUEUED')
    expect(job.sourceUri).toBe('/test.pdf')
    expect(getJob(job.id)?.id).toBe(job.id)
  })

  test('QUEUED → RUNNING → SUCCEEDED', () => {
    const job = createJob({ sourceUri: '/test2.pdf', sourceSha256: 'def456' })
    updateJobStatus(job.id, 'RUNNING', { startedAt: new Date().toISOString(), pageCount: 5 })
    expect(getJob(job.id)?.status).toBe('RUNNING')
    updateJobStatus(job.id, 'SUCCEEDED', { completedAt: new Date().toISOString() })
    expect(getJob(job.id)?.status).toBe('SUCCEEDED')
    expect(getJob(job.id)?.pageCount).toBe(5)
  })

  test('FAILED with error code', () => {
    const job = createJob({ sourceUri: '/bad.pdf', sourceSha256: 'bad001' })
    updateJobStatus(job.id, 'FAILED', { errorCode: 'NEEDS_PASSWORD', errorMessage: 'Encrypted PDF' })
    expect(getJob(job.id)?.errorCode).toBe('NEEDS_PASSWORD')
    expect(getJob(job.id)?.status).toBe('FAILED')
  })

  test('listJobs returns paginated results', () => {
    for (let i = 0; i < 5; i++) createJob({ sourceUri: `/list${i}.pdf`, sourceSha256: `list${i}` })
    const page1 = listJobs(3, 0)
    expect(page1.length).toBe(3)
  })

  test('deleteJob cascades', () => {
    const job = createJob({ sourceUri: '/del.pdf', sourceSha256: 'del001' })
    const page = upsertPage(job.id, 1, {})
    insertElement(page.id, 'TEXT', {})
    deleteJob(job.id)
    expect(getJob(job.id)).toBeNull()
  })
})

// ── Repository — Pages ────────────────────────────────────────

describe('Repository — pages', () => {
  test('upsert pages and retrieve by job', () => {
    const job = createJob({ sourceUri: '/pages.pdf', sourceSha256: 'pages123', pageCount: 3 })
    upsertPage(job.id, 1, { widthPt: 612, heightPt: 792 })
    upsertPage(job.id, 2, { widthPt: 612, heightPt: 792 })
    upsertPage(job.id, 3, { widthPt: 595, heightPt: 842 })
    const pages = getPagesByJob(job.id)
    expect(pages).toHaveLength(3)
    expect(pages[2].widthPt).toBe(595)
  })

  test('update page status with OCR data', () => {
    const job = createJob({ sourceUri: '/ocr.pdf', sourceSha256: 'ocr123' })
    const page = upsertPage(job.id, 1, {})
    updatePageStatus(page.id, 'done', { ocrApplied: true, ocrLanguage: 'eng', ocrConfidence: 0.92 })
    const updated = getPagesByJob(job.id)[0]
    expect(updated.ocrApplied).toBe(true)
    expect(updated.ocrLanguage).toBe('eng')
  })

  test('upsert is idempotent for same page number', () => {
    const job = createJob({ sourceUri: '/idem.pdf', sourceSha256: 'idem001' })
    upsertPage(job.id, 1, { widthPt: 612 })
    upsertPage(job.id, 1, { widthPt: 595 })
    expect(getPagesByJob(job.id)).toHaveLength(1)
  })
})

// ── Repository — Elements & text runs ────────────────────────

describe('Repository — elements and text runs', () => {
  test('insert TEXT element with multiple runs', () => {
    const job = createJob({ sourceUri: '/els.pdf', sourceSha256: 'els123' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'TEXT', { readingOrder: 0, bboxX: 50, bboxY: 700, bboxW: 200, bboxH: 20 })
    insertTextRun(elId, 0, { content: 'Hello', fontSize: 12, bold: false })
    insertTextRun(elId, 1, { content: ' World', fontSize: 12, bold: true, colorHex: '#ff0000' })

    const runs = getTextRunsByElement(elId)
    expect(runs).toHaveLength(2)
    expect(runs[0].content).toBe('Hello')
    expect(runs[1].bold).toBe(true)
    expect(runs[1].colorHex).toBe('#ff0000')
  })

  test('reading order preserved across elements', () => {
    const job = createJob({ sourceUri: '/order.pdf', sourceSha256: 'ord123' })
    const page = upsertPage(job.id, 1, {})
    insertElement(page.id, 'TEXT', { readingOrder: 2 })
    insertElement(page.id, 'IMAGE', { readingOrder: 0 })
    insertElement(page.id, 'TABLE', { readingOrder: 1 })
    const els = getElementsByPage(page.id)
    expect(els.map(e => e.readingOrder)).toEqual([0, 1, 2])
  })

  test('nested elements via parentElementId', () => {
    const job = createJob({ sourceUri: '/nested.pdf', sourceSha256: 'nest123' })
    const page = upsertPage(job.id, 1, {})
    const parentId = insertElement(page.id, 'FIGURE', {})
    const childId = insertElement(page.id, 'CAPTION', { parentElementId: parentId })
    const els = getElementsByPage(page.id)
    const child = els.find(e => e.id === childId)
    expect(child?.parentElementId).toBe(parentId)
  })
})

// ── Repository — Tables ───────────────────────────────────────

describe('Repository — tables and cells', () => {
  test('insert 3×3 table with header row', () => {
    const job = createJob({ sourceUri: '/table.pdf', sourceSha256: 'tbl123' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'TABLE', {})
    const tableId = insertTable(elId, 3, 3, { hasHeaderRow: true, gridlinesDetected: true })

    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        insertTableCell(tableId, r, c)

    const cells = getTableCells(tableId)
    expect(cells).toHaveLength(9)
  })

  test('merged cell with rowSpan and colSpan', () => {
    const job = createJob({ sourceUri: '/merge.pdf', sourceSha256: 'mg123' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'TABLE', {})
    const tableId = insertTable(elId, 2, 3)
    insertTableCell(tableId, 0, 0, { rowSpan: 2, colSpan: 1 })
    insertTableCell(tableId, 0, 1, { rowSpan: 1, colSpan: 2 })

    const cells = getTableCells(tableId)
    expect(cells[0].rowSpan).toBe(2)
    expect(cells[1].colSpan).toBe(2)
  })
})

// ── Repository — Links ────────────────────────────────────────

describe('Repository — links', () => {
  test('insert URL link', () => {
    const job = createJob({ sourceUri: '/links.pdf', sourceSha256: 'lnk123' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'LINK_AREA', {})
    insertLink(elId, 'URL', 'https://example.com', { bboxX: 50, bboxY: 600, bboxW: 150, bboxH: 20 })
    const els = getElementsByPage(page.id)
    expect(els.find(e => e.type === 'LINK_AREA')).toBeTruthy()
  })

  test('insert EMAIL link', () => {
    const job = createJob({ sourceUri: '/email.pdf', sourceSha256: 'em123' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'LINK_AREA', {})
    insertLink(elId, 'EMAIL', 'user@example.com')
    expect(getElementsByPage(page.id).find(e => e.type === 'LINK_AREA')).toBeTruthy()
  })
})

// ── Repository — Reconstruction map ──────────────────────────

describe('Repository — reconstruction map', () => {
  test('upsert and retrieve entries', () => {
    const job = createJob({ sourceUri: '/rmap.pdf', sourceSha256: 'rmap123' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'TEXT', {})
    upsertReconstructionMap(job.id, elId, 'doc-1', 'node-abc', 'paragraph', 0.95)

    const maps = getReconstructionMap(job.id)
    expect(maps).toHaveLength(1)
    expect(maps[0].editorNodeId).toBe('node-abc')
    expect(maps[0].fidelityScore).toBeCloseTo(0.95)
    expect(maps[0].roundtripOk).toBe(true)
  })

  test('upsert updates existing entry', () => {
    const job = createJob({ sourceUri: '/rmap2.pdf', sourceSha256: 'rmap2' })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'TEXT', {})
    upsertReconstructionMap(job.id, elId, 'doc-2', 'node-1', 'paragraph', 1.0)
    upsertReconstructionMap(job.id, elId, 'doc-2', 'node-1-updated', 'heading-1', 0.8)
    const maps = getReconstructionMap(job.id)
    expect(maps).toHaveLength(1)
    expect(maps[0].editorNodeId).toBe('node-1-updated')
  })
})

// ── Repository — Anomalies & metrics ─────────────────────────

describe('Repository — anomalies and telemetry', () => {
  test('log and retrieve anomalies by severity', () => {
    const job = createJob({ sourceUri: '/anom.pdf', sourceSha256: 'anom123' })
    logAnomaly(job.id, 'warning', 'FONT_MISSING', 'Font Arial not found', { font: 'Arial' })
    logAnomaly(job.id, 'info', 'IMAGE_ONLY_PDF', 'No text layer', {})
    logAnomaly(job.id, 'error', 'NEEDS_PASSWORD', 'Encrypted PDF', {})

    const anomalies = getAnomalies(job.id)
    expect(anomalies).toHaveLength(3)
    expect(anomalies.map(a => a.severity)).toContain('warning')
    expect(anomalies.map(a => a.code)).toContain('NEEDS_PASSWORD')
  })

  test('getJobMetrics returns accurate counts', () => {
    const job = createJob({ sourceUri: '/metrics.pdf', sourceSha256: 'met123', pageCount: 2 })
    const p1 = upsertPage(job.id, 1, {})
    const p2 = upsertPage(job.id, 2, {})
    updateJobStatus(job.id, 'SUCCEEDED', { completedAt: new Date().toISOString() })

    const el1 = insertElement(p1.id, 'TEXT', {})
    insertTextRun(el1, 0, { content: 'Hello', fontSize: 12 })
    insertElement(p1.id, 'IMAGE', {})
    insertElement(p2.id, 'TABLE', {})

    const el2 = insertElement(p2.id, 'TEXT', {})
    upsertReconstructionMap(job.id, el2, 'doc-m', 'node-m', 'paragraph', 0.9)

    const metrics = getJobMetrics(job.id)
    expect(metrics.totalElements).toBeGreaterThanOrEqual(4)
    expect(metrics.textRuns).toBeGreaterThanOrEqual(1)
    expect(metrics.images).toBeGreaterThanOrEqual(1)
    expect(metrics.tables).toBeGreaterThanOrEqual(1)
    expect(metrics.avgFidelity).toBeGreaterThan(0)
  })
})

// ── Repository — Export artifacts ────────────────────────────

describe('Repository — export artifacts', () => {
  test('create and update export artifact', () => {
    const job = createJob({ sourceUri: '/export.pdf', sourceSha256: 'exp123' })
    const artId = createExportArtifact(job.id, 'pdf')
    expect(artId).toBeTruthy()
    updateExportArtifact(artId, 'DONE', '/output/doc.pdf')
    const artifacts = testDb.prepare('SELECT * FROM export_artifact WHERE id=?').get(artId) as Record<string, unknown>
    expect(artifacts.status).toBe('DONE')
    expect(artifacts.path).toBe('/output/doc.pdf')
  })
})

// ── analyzeDocument (mocked pdfjs) ───────────────────────────

describe('analyzeDocument — ODL adapter', () => {
  test('returns correct page count', async () => {
    const dummyBytes = new Uint8Array(10)
    const result = await analyzeDocument(dummyBytes)
    expect(result.numPages).toBe(2)
    expect(result.pages).toHaveLength(2)
  })

  test('extracts text items from page', async () => {
    const result = await analyzeDocument(new Uint8Array(10))
    const items = result.pages[0].textItems
    expect(items.length).toBeGreaterThan(0)
    expect(items.find(i => i.str.includes('Hello'))).toBeTruthy()
  })

  test('extracts links from annotations', async () => {
    const result = await analyzeDocument(new Uint8Array(10))
    const links = result.pages[0].links
    expect(links.some(l => l.url === 'https://example.com')).toBe(true)
  })

  test('respects page range (start=2, end=2 gets 1 page)', async () => {
    const result = await analyzeDocument(new Uint8Array(10), undefined, { start: 2, end: 2 })
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0].pageNumber).toBe(2)
  })
})

// ── reconstructToHtml — fidelity ─────────────────────────────

describe('reconstructToHtml — fidelity', () => {
  const opts = { mode: 'EditableFlow' as const, preservePageBreaks: true, detectLists: true, reconstructTables: true }

  async function getOdl() {
    return analyzeDocument(new Uint8Array(10))
  }

  test('produces valid HTML', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-1', 'doc-1', opts)
    expect(html).toBeTruthy()
    expect(html).toContain('<p')
  })

  test('detects heading from large font (28pt vs 12pt body)', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-2', 'doc-2', opts)
    // Big Heading Text is 28pt, body is 12pt — ratio ≥ 2.0 → H1
    expect(html).toMatch(/<h[1-3]/)
  })

  test('detects bullet list items', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-3', 'doc-3', opts)
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>')
  })

  test('detects numbered list items', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-4', 'doc-4', opts)
    expect(html).toContain('<ol>')
  })

  test('adds HR page breaks between pages', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-5', 'doc-5', opts)
    expect(html).toContain('<hr')
  })

  test('elements array populated with node IDs and fidelity scores', async () => {
    const odl = await getOdl()
    const { elements } = reconstructToHtml(odl, 'job-6', 'doc-6', opts)
    expect(elements.length).toBeGreaterThan(0)
    elements.forEach(el => {
      expect(el.nodeId).toBeTruthy()
      expect(el.fidelityScore).toBeGreaterThanOrEqual(0)
      expect(el.fidelityScore).toBeLessThanOrEqual(1)
    })
  })

  test('bold text wrapped in <strong>', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-7', 'doc-7', opts)
    expect(html).toContain('<strong>')
  })

  test('list detection disabled when detectLists=false', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-8', 'doc-8', { ...opts, detectLists: false })
    // Bullets should appear as plain paragraphs, not <ul>
    expect(html).not.toContain('<ul>')
  })

  test('no HR when preservePageBreaks=false', async () => {
    const odl = await getOdl()
    const { html } = reconstructToHtml(odl, 'job-9', 'doc-9', { ...opts, preservePageBreaks: false })
    expect(html).not.toContain('<hr')
  })
})

// ── Round-trip ────────────────────────────────────────────────

describe('Round-trip: analyze → reconstruct → store → verify', () => {
  test('full pipeline stores all entities and returns valid HTML', async () => {
    const job = createJob({ sourceUri: '/rt.pdf', sourceSha256: 'rt001' })
    updateJobStatus(job.id, 'RUNNING', { startedAt: new Date().toISOString() })

    const odl = await analyzeDocument(new Uint8Array(10))
    const editorDocId = 'rt-editor-doc'

    // Persist pages and elements
    for (const p of odl.pages) {
      const dbPage = upsertPage(job.id, p.pageNumber, { widthPt: p.width, heightPt: p.height })
      let ro = 0
      for (const item of p.textItems) {
        const elId = insertElement(dbPage.id, 'TEXT', { readingOrder: ro++ })
        insertTextRun(elId, 0, { content: item.str, fontSize: 12 })
      }
      updatePageStatus(dbPage.id, 'done')
    }

    const { html, elements } = reconstructToHtml(odl, job.id, editorDocId, {
      mode: 'EditableFlow', preservePageBreaks: true, detectLists: true, reconstructTables: true,
    })

    // Map reconstruction entries to real persisted element IDs
    const persistedEls = odl.pages.flatMap(p => {
      const dbPage = getPagesByJob(job.id).find(dp => dp.pageNumber === p.pageNumber)!
      return getElementsByPage(dbPage.id)
    })
    elements.slice(0, persistedEls.length).forEach((el, i) => {
      upsertReconstructionMap(job.id, persistedEls[i].id, editorDocId, el.nodeId, el.nodeType, el.fidelityScore)
    })

    updateJobStatus(job.id, 'SUCCEEDED', { completedAt: new Date().toISOString(), pageCount: odl.pages.length })

    // Verify
    expect(html).toBeTruthy()
    expect(getJob(job.id)?.status).toBe('SUCCEEDED')
    expect(getReconstructionMap(job.id).length).toBeGreaterThan(0)
    const metrics = getJobMetrics(job.id)
    expect(metrics.totalPages).toBe(2)
    expect(metrics.completedPages).toBe(2)
    expect(metrics.avgFidelity).toBeGreaterThan(0)
  })
})

// ── Performance baseline ──────────────────────────────────────

describe('Performance — large PDF baseline', () => {
  test('creates 200 job records under 300ms', () => {
    const start = Date.now()
    for (let i = 0; i < 200; i++) {
      createJob({ sourceUri: `/perf${i}.pdf`, sourceSha256: `sha256-${i}-${Date.now()}` })
    }
    expect(Date.now() - start).toBeLessThan(300)
  })

  test('upserts 100 pages under 200ms', () => {
    const job = createJob({ sourceUri: '/bigpdf.pdf', sourceSha256: `big-${Date.now()}`, pageCount: 100 })
    const start = Date.now()
    for (let i = 1; i <= 100; i++) upsertPage(job.id, i, { widthPt: 612, heightPt: 792 })
    expect(Date.now() - start).toBeLessThan(200)
    expect(getPagesByJob(job.id)).toHaveLength(100)
  })

  test('inserts 1000 text runs under 500ms', () => {
    const job = createJob({ sourceUri: '/runs.pdf', sourceSha256: `runs-${Date.now()}` })
    const page = upsertPage(job.id, 1, {})
    const elId = insertElement(page.id, 'TEXT', {})
    const start = Date.now()
    for (let i = 0; i < 1000; i++) insertTextRun(elId, i, { content: `word${i}`, fontSize: 12 })
    expect(Date.now() - start).toBeLessThan(500)
  })
})

// ── Encrypted PDF handling ────────────────────────────────────

describe('Encrypted and edge-case PDFs', () => {
  test('job stores NEEDS_PASSWORD error correctly', () => {
    const job = createJob({ sourceUri: '/enc.pdf', sourceSha256: 'enc001' })
    updateJobStatus(job.id, 'FAILED', { errorCode: 'NEEDS_PASSWORD', errorMessage: 'PDF requires password' })
    logAnomaly(job.id, 'error', 'NEEDS_PASSWORD', 'PDF requires password', {})
    expect(getJob(job.id)?.errorCode).toBe('NEEDS_PASSWORD')
    expect(getAnomalies(job.id)[0].code).toBe('NEEDS_PASSWORD')
  })

  test('IMAGE_ONLY_PDF anomaly logged for no-text PDFs', () => {
    const job = createJob({ sourceUri: '/scan.pdf', sourceSha256: 'scan001' })
    logAnomaly(job.id, 'warning', 'IMAGE_ONLY_PDF', 'No text layer — run OCR', {})
    expect(getAnomalies(job.id)[0].code).toBe('IMAGE_ONLY_PDF')
  })

  test('CANCELLED status stops further processing', () => {
    const job = createJob({ sourceUri: '/cancel.pdf', sourceSha256: 'can001' })
    updateJobStatus(job.id, 'RUNNING', { startedAt: new Date().toISOString() })
    updateJobStatus(job.id, 'CANCELLED', { completedAt: new Date().toISOString() })
    expect(getJob(job.id)?.status).toBe('CANCELLED')
  })

  test('PARTIAL status with some completed pages', () => {
    const job = createJob({ sourceUri: '/partial.pdf', sourceSha256: 'par001', pageCount: 5 })
    for (let i = 1; i <= 3; i++) {
      const p = upsertPage(job.id, i, {}); updatePageStatus(p.id, 'done')
    }
    for (let i = 4; i <= 5; i++) {
      const p = upsertPage(job.id, i, {}); updatePageStatus(p.id, 'failed')
    }
    updateJobStatus(job.id, 'PARTIAL', { completedAt: new Date().toISOString() })
    const metrics = getJobMetrics(job.id)
    expect(metrics.completedPages).toBe(3)
    expect(metrics.failedPages).toBe(2)
  })
})
