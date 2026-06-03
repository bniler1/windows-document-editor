/**
 * Tests for PDF Split & Merge service.
 * Uses real pdf-lib to create small test PDFs in-memory.
 */
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { parsePageRange, splitPdf, mergePdfs, getPdfStats } from '../electron/services/splitMergeService'

const TMP = os.tmpdir()

async function makePdf(pages: number): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  const bytes = await doc.save()
  const p = path.join(TMP, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  fs.writeFileSync(p, bytes)
  return p
}

function makeTmpDir(): string {
  const d = path.join(TMP, `out-${Date.now()}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

// ── parsePageRange ────────────────────────────────────────────────────────────

describe('parsePageRange', () => {
  test('all / empty returns all pages', () => {
    expect(parsePageRange('all', 5)).toEqual([1, 2, 3, 4, 5])
    expect(parsePageRange('', 3)).toEqual([1, 2, 3])
  })

  test('single page', () => {
    expect(parsePageRange('3', 5)).toEqual([3])
  })

  test('range a-b', () => {
    expect(parsePageRange('2-4', 6)).toEqual([2, 3, 4])
  })

  test('open range a-', () => {
    expect(parsePageRange('4-', 6)).toEqual([4, 5, 6])
  })

  test('open range -b', () => {
    expect(parsePageRange('-3', 6)).toEqual([1, 2, 3])
  })

  test('odd/even keywords', () => {
    expect(parsePageRange('odd', 6)).toEqual([1, 3, 5])
    expect(parsePageRange('even', 6)).toEqual([2, 4, 6])
  })

  test('comma-separated, no duplicates', () => {
    expect(parsePageRange('1,3,1,5', 6)).toEqual([1, 3, 5])
  })

  test('out-of-bounds pages silently ignored', () => {
    expect(parsePageRange('1-100', 3)).toEqual([1, 2, 3])
  })

  test('invalid token throws INVALID_RANGE', () => {
    expect(() => parsePageRange('abc', 5)).toThrow('INVALID_RANGE')
  })
})

// ── splitPdf ──────────────────────────────────────────────────────────────────

describe('splitPdf', () => {
  test('splits a 10-page PDF into two parts', async () => {
    const src = await makePdf(10)
    const outDir = makeTmpDir()
    const result = await splitPdf({
      sourcePath: src,
      outputDir: outDir,
      ranges: ['1-5', '6-10'],
      overwrite: true,
    })
    expect(result.outputs).toHaveLength(2)
    expect(result.errors).toHaveLength(0)
    expect(result.outputs[0].pages).toBe(5)
    expect(result.outputs[1].pages).toBe(5)
    expect(fs.existsSync(result.outputs[0].path)).toBe(true)
  })

  test('partial failure continues best-effort', async () => {
    const src = await makePdf(5)
    const outDir = makeTmpDir()
    const result = await splitPdf({
      sourcePath: src,
      outputDir: outDir,
      ranges: ['1-3', 'invalid-range'],
      overwrite: true,
    })
    expect(result.outputs).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
  })

  test('throws FILE_IO for missing source', async () => {
    await expect(splitPdf({
      sourcePath: '/nonexistent/file.pdf',
      outputDir: TMP,
      ranges: ['1'],
    })).rejects.toThrow('FILE_IO')
  })
})

// ── mergePdfs ─────────────────────────────────────────────────────────────────

describe('mergePdfs', () => {
  test('merges two PDFs into one', async () => {
    const a = await makePdf(3)
    const b = await makePdf(4)
    const outPath = path.join(TMP, `merged-${Date.now()}.pdf`)
    const result = await mergePdfs({
      inputs: [{ path: a }, { path: b }],
      outputPath: outPath,
      overwrite: true,
    })
    expect(result.totalPages).toBe(7)
    expect(result.sourceFiles).toBe(2)
    expect(fs.existsSync(outPath)).toBe(true)
  })

  test('respects per-file page range', async () => {
    const a = await makePdf(6)
    const b = await makePdf(4)
    const outPath = path.join(TMP, `merged-range-${Date.now()}.pdf`)
    const result = await mergePdfs({
      inputs: [{ path: a, pageRange: '1-2' }, { path: b, pageRange: 'odd' }],
      outputPath: outPath,
      overwrite: true,
    })
    expect(result.totalPages).toBe(4) // 2 + 2(odd pages 1,3)
  })

  test('throws CONFLICT if output exists and overwrite=false', async () => {
    const a = await makePdf(2)
    const outPath = path.join(TMP, `conflict-${Date.now()}.pdf`)
    fs.writeFileSync(outPath, 'dummy')
    await expect(mergePdfs({
      inputs: [{ path: a }],
      outputPath: outPath,
      overwrite: false,
    })).rejects.toThrow('CONFLICT')
  })

  test('throws INVALID_INPUT with zero inputs', async () => {
    await expect(mergePdfs({
      inputs: [],
      outputPath: path.join(TMP, 'empty.pdf'),
      overwrite: true,
    })).rejects.toThrow('INVALID_INPUT')
  })
})

// ── getPdfStats ───────────────────────────────────────────────────────────────

describe('getPdfStats', () => {
  test('returns page count and size', async () => {
    const src = await makePdf(7)
    const stats = await getPdfStats(src)
    expect(stats.pages).toBe(7)
    expect(stats.fileSizeBytes).toBeGreaterThan(0)
    expect(stats.isEncrypted).toBe(false)
  })
})
