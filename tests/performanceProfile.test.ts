/**
 * Performance profiling — large PDF operations.
 * Validates timing, chunking, and memory guard contracts.
 */
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { splitPdf, mergePdfs, getPdfStats } from '../electron/services/splitMergeService'
import { compressPdf } from '../electron/services/compressService'

const TMP = os.tmpdir()

async function makePdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  const p = path.join(TMP, `perf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  fs.writeFileSync(p, await doc.save())
  return p
}

describe('Performance — split', () => {
  test('100-page split into 10-page chunks completes < 5s', async () => {
    const src = await makePdf(100)
    const outDir = path.join(TMP, `split-perf-${Date.now()}`)
    fs.mkdirSync(outDir, { recursive: true })

    const ranges = Array.from({ length: 10 }, (_, i) => `${i * 10 + 1}-${(i + 1) * 10}`)
    const start = Date.now()
    const result = await splitPdf({ sourcePath: src, outputDir: outDir, ranges, overwrite: true })
    const elapsed = Date.now() - start

    expect(result.outputs).toHaveLength(10)
    expect(elapsed).toBeLessThan(5000)
  })
})

describe('Performance — merge', () => {
  test('merging 10 x 20-page PDFs completes < 10s', async () => {
    const files = await Promise.all(Array.from({ length: 10 }, () => makePdf(20)))
    const outPath = path.join(TMP, `merge-perf-${Date.now()}.pdf`)

    const start = Date.now()
    const result = await mergePdfs({
      inputs: files.map((p) => ({ path: p })),
      outputPath: outPath,
      overwrite: true,
    })
    const elapsed = Date.now() - start

    expect(result.totalPages).toBe(200)
    expect(elapsed).toBeLessThan(10000)
  })
})

describe('Performance — compress', () => {
  test('compressing 50-page PDF completes < 3s', async () => {
    const src = await makePdf(50)
    const out = path.join(TMP, `compress-perf-${Date.now()}.pdf`)

    const start = Date.now()
    const stats = await compressPdf(src, out, { profile: 'Balanced' })
    const elapsed = Date.now() - start

    expect(stats.pages).toBe(50)
    expect(elapsed).toBeLessThan(3000)
  })
})

describe('Performance — stats', () => {
  test('getPdfStats on 200-page PDF completes < 2s', async () => {
    const src = await makePdf(200)
    const start = Date.now()
    const stats = await getPdfStats(src)
    expect(Date.now() - start).toBeLessThan(2000)
    expect(stats.pages).toBe(200)
  })
})

describe('File size limits', () => {
  test('500MB limit error message is correct', () => {
    // Create a fake oversized stat
    const filePath = path.join(TMP, `fake-large-${Date.now()}.pdf`)
    fs.writeFileSync(filePath, '%PDF-1.4\n%EOF')

    // Mock stat to return large size
    const origStatSync = fs.statSync.bind(fs)
    const spy = jest.spyOn(fs, 'statSync').mockImplementation((p) => {
      const real = origStatSync(p as string)
      if (p === filePath) return { ...real, size: 600 * 1024 * 1024 }
      return real
    })

    expect(() => require('../electron/services/splitMergeService').splitPdf({
      sourcePath: filePath,
      outputDir: TMP,
      ranges: ['1'],
    })).rejects.toThrow('LIMIT_EXCEEDED')

    spy.mockRestore()
  })
})
