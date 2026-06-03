/**
 * Tests for Annotation service: watermarks, highlights, comments, redactions.
 */
import { DatabaseSync } from 'node:sqlite'
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { jest } from '@jest/globals'

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: jest.fn() },
  dialog: {},
}))

import * as dbModule from '../electron/services/database'
import {
  ensureAnnotationTables,
  upsertWatermark,
  getWatermark,
  removeWatermark,
  addAnnotation,
  getAnnotations,
  updateAnnotation,
  deleteAnnotation,
  applyRedactionsToPdf,
} from '../electron/services/annotationService'

const TMP = os.tmpdir()
let testDb: DatabaseSync

beforeAll(() => {
  testDb = new DatabaseSync(':memory:')
  testDb.exec('PRAGMA foreign_keys=ON')
  Object.defineProperty(dbModule, 'getDb', { value: () => testDb, writable: true })
  ensureAnnotationTables()
})

afterAll(() => testDb.close())

async function makePdf(pages = 3): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  const p = path.join(TMP, `ann-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  fs.writeFileSync(p, await doc.save())
  return p
}

describe('Watermark', () => {
  test('upsert and retrieve watermark', () => {
    upsertWatermark({ documentId: 'doc-wm-1', type: 'text', content: 'CONFIDENTIAL', opacity: 0.4 })
    const wm = getWatermark('doc-wm-1')
    expect(wm?.content).toBe('CONFIDENTIAL')
    expect(wm?.opacity).toBe(0.4)
  })

  test('upsert replaces existing watermark', () => {
    upsertWatermark({ documentId: 'doc-wm-2', type: 'text', content: 'DRAFT', opacity: 0.3 })
    upsertWatermark({ documentId: 'doc-wm-2', type: 'text', content: 'FINAL', opacity: 0.5 })
    const wm = getWatermark('doc-wm-2')
    expect(wm?.content).toBe('FINAL')
  })

  test('remove watermark', () => {
    upsertWatermark({ documentId: 'doc-wm-3', type: 'text', content: 'X' })
    removeWatermark('doc-wm-3')
    expect(getWatermark('doc-wm-3')).toBeNull()
  })
})

describe('Annotations', () => {
  test('add and retrieve highlight', () => {
    const ann = addAnnotation('doc-ann-1', 1, 'highlight', { x: 10, y: 20, width: 100, height: 15 }, { color: '#ffff00' })
    expect(ann.type).toBe('highlight')
    expect(ann.color).toBe('#ffff00')
    expect(ann.pageNumber).toBe(1)
  })

  test('add comment with content', () => {
    const ann = addAnnotation('doc-ann-1', 2, 'comment', { x: 0, y: 0, width: 10, height: 10 }, { content: 'Review this section' })
    expect(ann.content).toBe('Review this section')
    expect(ann.status).toBe('open')
  })

  test('get annotations for document', () => {
    const anns = getAnnotations('doc-ann-1')
    expect(anns.length).toBeGreaterThanOrEqual(2)
  })

  test('get annotations filtered by page', () => {
    const p1 = getAnnotations('doc-ann-1', 1)
    const p2 = getAnnotations('doc-ann-1', 2)
    expect(p1.every((a) => a.pageNumber === 1)).toBe(true)
    expect(p2.every((a) => a.pageNumber === 2)).toBe(true)
  })

  test('update annotation status', () => {
    const ann = addAnnotation('doc-ann-upd', 1, 'comment', { x: 0, y: 0, width: 10, height: 10 }, { content: 'Todo' })
    const updated = updateAnnotation(ann.id, { status: 'resolved' })
    expect(updated?.status).toBe('resolved')
  })

  test('delete annotation removes it', () => {
    const ann = addAnnotation('doc-ann-del', 1, 'highlight', { x: 0, y: 0, width: 10, height: 10 })
    deleteAnnotation(ann.id)
    expect(getAnnotations('doc-ann-del')).toHaveLength(0)
  })
})

describe('Redactions', () => {
  test('applies redaction boxes to PDF', async () => {
    const src = await makePdf(2)
    const out = path.join(TMP, `redacted-${Date.now()}.pdf`)

    addAnnotation('doc-redact-1', 1, 'redaction', { x: 50, y: 100, width: 200, height: 20 })
    const result = await applyRedactionsToPdf(src, out, 'doc-redact-1')

    expect(result.redactedCount).toBe(1)
    expect(fs.existsSync(out)).toBe(true)

    // Verify the output PDF is valid
    const outBytes = fs.readFileSync(out)
    const doc = await PDFDocument.load(outBytes)
    expect(doc.getPageCount()).toBe(2)
  })

  test('returns zero when no pending redactions', async () => {
    const src = await makePdf(1)
    const out = path.join(TMP, `no-redact-${Date.now()}.pdf`)
    const result = await applyRedactionsToPdf(src, out, 'doc-no-redactions')
    expect(result.redactedCount).toBe(0)
  })
})
