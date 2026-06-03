/**
 * Tests for PDF Compress & Optimize service.
 */
import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { compressPdf, getPdfFileStats } from '../electron/services/compressService'

const TMP = os.tmpdir()

async function makePdf(pages = 3): Promise<string> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  const bytes = await doc.save()
  const p = path.join(TMP, `compress-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`)
  fs.writeFileSync(p, bytes)
  return p
}

describe('compressPdf', () => {
  test('HighQuality profile compresses and writes output', async () => {
    const src = await makePdf(3)
    const out = path.join(TMP, `out-hq-${Date.now()}.pdf`)
    const stats = await compressPdf(src, out, { profile: 'HighQuality' })
    expect(stats.pages).toBe(3)
    expect(stats.outputSizeBytes).toBeGreaterThan(0)
    expect(fs.existsSync(out)).toBe(true)
  })

  test('Smallest profile removes metadata', async () => {
    const src = await makePdf(2)
    const out = path.join(TMP, `out-sm-${Date.now()}.pdf`)
    const stats = await compressPdf(src, out, { profile: 'Smallest' })
    expect(stats.metadataRemoved).toBe(false) // blank doc has no XMP to remove
    expect(stats.pages).toBe(2)
  })

  test('Balanced profile produces output', async () => {
    const src = await makePdf(5)
    const out = path.join(TMP, `out-bal-${Date.now()}.pdf`)
    const stats = await compressPdf(src, out, { profile: 'Balanced' })
    expect(stats.pages).toBe(5)
    expect(stats.outputSizeBytes).toBeGreaterThan(0)
  })

  test('throws FILE_IO for missing input', async () => {
    await expect(compressPdf('/missing.pdf', '/out.pdf', { profile: 'Balanced' })).rejects.toThrow('FILE_IO')
  })

  test('savedPercent is numeric', async () => {
    const src = await makePdf(4)
    const out = path.join(TMP, `out-pct-${Date.now()}.pdf`)
    const stats = await compressPdf(src, out)
    expect(typeof stats.savedPercent).toBe('number')
    expect(stats.savedPercent).toBeGreaterThanOrEqual(0)
  })
})

describe('getPdfFileStats', () => {
  test('returns page count', async () => {
    const src = await makePdf(5)
    const stats = await getPdfFileStats(src)
    expect(stats.pages).toBe(5)
    expect(stats.fileSizeBytes).toBeGreaterThan(0)
  })

  test('throws for missing file', async () => {
    await expect(getPdfFileStats('/nope.pdf')).rejects.toThrow('FILE_IO')
  })
})
