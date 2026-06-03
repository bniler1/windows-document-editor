/**
 * OCR language pack management and accuracy baseline tests.
 * Validates language list completeness, multi-language config, and offline guarantees.
 */
import { jest } from '@jest/globals'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import os from 'os'

jest.mock('electron', () => ({
  app: { getPath: (_: string) => '/tmp', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: jest.fn() },
  dialog: {},
}))

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn().mockResolvedValue({
    recognize: jest.fn().mockResolvedValue({
      data: { text: 'Hello World', confidence: 88, blocks: [] },
    }),
    terminate: jest.fn(),
  }),
}))

import * as dbModule from '../electron/services/database'
import { getInstalledLanguages, createOcrJob, cancelOcrJob } from '../electron/services/ocrService'

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

describe('OCR language packs', () => {
  test('at least 20 languages available', () => {
    const langs = getInstalledLanguages()
    expect(langs.length).toBeGreaterThanOrEqual(20)
  })

  test('all required European languages present', () => {
    const langs = getInstalledLanguages()
    const codes = new Set(langs.map((l) => l.code))
    const required = ['eng', 'spa', 'fra', 'deu', 'ita', 'por', 'nld', 'pol', 'swe', 'nor', 'dan', 'fin', 'tur']
    for (const code of required) {
      expect(codes.has(code)).toBe(true)
    }
  })

  test('CJK languages present', () => {
    const langs = getInstalledLanguages()
    const codes = new Set(langs.map((l) => l.code))
    expect(codes.has('chi_sim')).toBe(true)
    expect(codes.has('jpn')).toBe(true)
    expect(codes.has('kor')).toBe(true)
  })

  test('each language has a non-empty name', () => {
    const langs = getInstalledLanguages()
    for (const l of langs) {
      expect(typeof l.name).toBe('string')
      expect(l.name.length).toBeGreaterThan(0)
    }
  })
})

describe('OCR multi-language job config', () => {
  function makeTempPdf(): string {
    const p = path.join(os.tmpdir(), `ocr-lang-${Date.now()}.pdf`)
    fs.writeFileSync(p, '%PDF-1.4\n/Count 1\n%EOF\n')
    return p
  }

  test('eng+spa job stores both language codes', () => {
    const p = makeTempPdf()
    const job = createOcrJob({ pdfPath: p, languages: ['eng', 'spa'] })
    cancelOcrJob(job.id)
    expect(job.requestedLanguages).toBe('eng,spa')
  })

  test('single language job stores one code', () => {
    const p = makeTempPdf()
    const job = createOcrJob({ pdfPath: p, languages: ['fra'] })
    cancelOcrJob(job.id)
    expect(job.requestedLanguages).toBe('fra')
  })

  test('max 3 languages enforced by caller convention', () => {
    const p = makeTempPdf()
    const job = createOcrJob({ pdfPath: p, languages: ['eng', 'spa', 'fra'] })
    cancelOcrJob(job.id)
    expect(job.requestedLanguages.split(',').length).toBe(3)
  })
})

describe('OCR offline guarantee', () => {
  test('getInstalledLanguages makes no network calls', () => {
    const originalFetch = global.fetch
    let fetchCalled = false
    global.fetch = async () => { fetchCalled = true; return new Response() }
    getInstalledLanguages()
    global.fetch = originalFetch
    expect(fetchCalled).toBe(false)
  })
})
