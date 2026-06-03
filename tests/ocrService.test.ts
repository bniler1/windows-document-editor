/**
 * OCR service unit tests — job lifecycle, queue, cancellation, language list.
 * Uses node:sqlite in-memory DB. Does NOT run real OCR.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

jest.mock('electron', () => ({
  app: { getPath: (_: string) => '/tmp', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: jest.fn() },
  dialog: {},
}))

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn().mockResolvedValue({
    recognize: jest.fn().mockResolvedValue({
      data: { text: 'Sample OCR text', confidence: 85, blocks: [] },
    }),
    terminate: jest.fn(),
  }),
}))

import * as dbModule from '../electron/services/database'
import {
  createOcrJob,
  getOcrJob,
  getOcrJobProgress,
  cancelOcrJob,
  getInstalledLanguages,
} from '../electron/services/ocrService'

let testDb: DatabaseSync

beforeAll(() => {
  testDb = new DatabaseSync(':memory:')
  testDb.exec('PRAGMA journal_mode=WAL')
  testDb.exec('PRAGMA foreign_keys=ON')

  const migsDir = path.join(__dirname, '..', 'db', 'migrations')
  for (const f of fs.readdirSync(migsDir).sort()) {
    if (f.endsWith('.sql')) {
      testDb.exec(fs.readFileSync(path.join(migsDir, f), 'utf-8'))
    }
  }

  Object.defineProperty(dbModule, 'getDb', { value: () => testDb, writable: true })
})

afterAll(() => testDb.close())

function makeTempPdf(): string {
  const tmpPath = path.join('/tmp', `test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  fs.writeFileSync(tmpPath, '%PDF-1.4\n/Count 3\n%EOF\n')
  return tmpPath
}

describe('OCR — createJob', () => {
  test('creates job record with queued status', () => {
    const pdfPath = makeTempPdf()
    const job = createOcrJob({ pdfPath, languages: ['eng'] })
    expect(job.status).toBe('queued')
    expect(job.sourcePdfUri).toBe(pdfPath)
    expect(job.requestedLanguages).toBe('eng')
  })

  test('throws PDF_NOT_FOUND for missing file', () => {
    expect(() =>
      createOcrJob({ pdfPath: '/nonexistent/file.pdf', languages: ['eng'] }),
    ).toThrow('PDF_NOT_FOUND')
  })

  test('records multiple languages joined with comma', () => {
    const pdfPath = makeTempPdf()
    const job = createOcrJob({ pdfPath, languages: ['eng', 'spa'] })
    expect(job.requestedLanguages).toBe('eng,spa')
  })
})

describe('OCR — getProgress', () => {
  test('returns progress object with page list', () => {
    const pdfPath = makeTempPdf()
    const job = createOcrJob({ pdfPath, languages: ['eng'] })
    const progress = getOcrJobProgress(job.id)
    expect(progress).not.toBeNull()
    expect(typeof progress!.progress.pagesTotal).toBe('number')
  })
})

describe('OCR — cancelJob', () => {
  test('cancels a queued job', () => {
    const pdfPath = makeTempPdf()
    const job = createOcrJob({ pdfPath })
    const ok = cancelOcrJob(job.id)
    expect(ok).toBe(true)
    expect(getOcrJob(job.id)?.status).toBe('canceled')
  })

  test('returns false for non-existent job', () => {
    expect(cancelOcrJob('fake-id-does-not-exist')).toBe(false)
  })
})

describe('OCR — getInstalledLanguages', () => {
  test('returns at least 20 languages', () => {
    const langs = getInstalledLanguages()
    expect(langs.length).toBeGreaterThanOrEqual(20)
    expect(langs.find((l) => l.code === 'eng')?.name).toBe('English')
  })

  test('supports Spanish', () => {
    const langs = getInstalledLanguages()
    expect(langs.find((l) => l.code === 'spa')?.name).toBe('Spanish')
  })
})

describe('OCR — large PDF perf baseline', () => {
  test('enqueuing a job completes in under 500ms', () => {
    const pdfPath = makeTempPdf()
    const start = Date.now()
    const job = createOcrJob({ pdfPath, languages: ['eng'] })
    expect(Date.now() - start).toBeLessThan(500)
    expect(job.status).toBe('queued')
    // Cancel to avoid running actual OCR in tests
    cancelOcrJob(job.id)
  })
})
