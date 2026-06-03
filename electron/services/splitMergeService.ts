import { PDFDocument } from 'pdf-lib'
import fs from 'fs'
import path from 'path'

export type RangeToken = { kind: 'page'; n: number } | { kind: 'range'; a: number; b: number | null } | { kind: 'keyword'; word: 'odd' | 'even' }

// ── Page range parsing ────────────────────────────────────────────────────────

export function parsePageRange(spec: string, totalPages: number): number[] {
  if (!spec || spec.trim() === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }

  const seen = new Set<number>()
  const result: number[] = []

  for (const token of spec.split(',').map((t) => t.trim()).filter(Boolean)) {
    if (token === 'odd') {
      for (let i = 1; i <= totalPages; i += 2) addPage(i, totalPages, seen, result)
    } else if (token === 'even') {
      for (let i = 2; i <= totalPages; i += 2) addPage(i, totalPages, seen, result)
    } else if (token.includes('-')) {
      const [aStr, bStr] = token.split('-')
      const a = aStr ? parseInt(aStr, 10) : 1
      const b = bStr ? parseInt(bStr, 10) : totalPages
      if (isNaN(a) || isNaN(b)) throw new Error(`INVALID_RANGE: "${token}"`)
      for (let i = a; i <= b; i++) addPage(i, totalPages, seen, result)
    } else {
      const n = parseInt(token, 10)
      if (isNaN(n)) throw new Error(`INVALID_RANGE: "${token}"`)
      addPage(n, totalPages, seen, result)
    }
  }

  return result
}

function addPage(n: number, total: number, seen: Set<number>, result: number[]): void {
  if (n >= 1 && n <= total && !seen.has(n)) {
    seen.add(n)
    result.push(n)
  }
}

// ── Split ─────────────────────────────────────────────────────────────────────

export interface SplitRequest {
  sourcePath: string
  outputDir: string
  ranges: string[]          // one output file per entry; each is a page range spec
  nameTemplate?: string     // e.g. "{basename}_part{index}" — default
  password?: string
  overwrite?: boolean
}

export interface SplitResult {
  outputs: Array<{ path: string; pages: number; rangeSpec: string }>
  errors: Array<{ index: number; rangeSpec: string; error: string }>
}

export async function splitPdf(req: SplitRequest): Promise<SplitResult> {
  validateFile(req.sourcePath)

  const srcBytes = fs.readFileSync(req.sourcePath)
  const srcDoc = await PDFDocument.load(srcBytes, {
    password: req.password,
    ignoreEncryption: !req.password,
  } as any)
  const totalPages = srcDoc.getPageCount()
  const basename = path.basename(req.sourcePath, path.extname(req.sourcePath))
  const template = req.nameTemplate ?? '{basename}_part{index}'
  const outputs: SplitResult['outputs'] = []
  const errors: SplitResult['errors'] = []

  for (let i = 0; i < req.ranges.length; i++) {
    const rangeSpec = req.ranges[i]
    try {
      const pages = parsePageRange(rangeSpec, totalPages)
      if (pages.length === 0) throw new Error('INVALID_RANGE: resolves to zero pages')

      const outDoc = await PDFDocument.create()
      const copied = await outDoc.copyPages(srcDoc, pages.map((p) => p - 1))
      copied.forEach((pg) => outDoc.addPage(pg))

      const name = template
        .replace('{basename}', basename)
        .replace('{index}', String(i + 1).padStart(3, '0'))
      const outPath = path.join(req.outputDir, `${name}.pdf`)

      if (!req.overwrite && fs.existsSync(outPath)) {
        throw new Error(`CONFLICT: output already exists at ${outPath}`)
      }

      const bytes = await outDoc.save()
      fs.writeFileSync(outPath, bytes)
      outputs.push({ path: outPath, pages: pages.length, rangeSpec })
    } catch (err) {
      errors.push({ index: i, rangeSpec, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { outputs, errors }
}

// ── Merge ─────────────────────────────────────────────────────────────────────

export interface MergeInputFile {
  path: string
  pageRange?: string   // optional; defaults to "all"
  password?: string
}

export interface MergeRequest {
  inputs: MergeInputFile[]
  outputPath: string
  overwrite?: boolean
}

export interface MergeResult {
  outputPath: string
  totalPages: number
  sourceFiles: number
}

export async function mergePdfs(req: MergeRequest): Promise<MergeResult> {
  if (!req.overwrite && fs.existsSync(req.outputPath)) {
    throw new Error(`CONFLICT: output already exists at ${req.outputPath}`)
  }
  if (req.inputs.length === 0) throw new Error('INVALID_INPUT: no input files provided')

  const outDoc = await PDFDocument.create()
  let totalPages = 0
  const fieldPrefixes = new Map<number, string>()

  for (let docIdx = 0; docIdx < req.inputs.length; docIdx++) {
    const inp = req.inputs[docIdx]
    validateFile(inp.path)

    const bytes = fs.readFileSync(inp.path)
    const srcDoc = await PDFDocument.load(bytes, {
      password: inp.password,
      ignoreEncryption: !inp.password,
    } as any)

    const pageCount = srcDoc.getPageCount()
    const pages = parsePageRange(inp.pageRange ?? 'all', pageCount)
    const copied = await outDoc.copyPages(srcDoc, pages.map((p) => p - 1))
    copied.forEach((pg) => outDoc.addPage(pg))
    totalPages += pages.length
    fieldPrefixes.set(docIdx, `f${docIdx}_`)
  }

  const bytes = await outDoc.save()
  fs.mkdirSync(path.dirname(req.outputPath), { recursive: true })
  fs.writeFileSync(req.outputPath, bytes)

  return { outputPath: req.outputPath, totalPages, sourceFiles: req.inputs.length }
}

// ── PDF stats ─────────────────────────────────────────────────────────────────

export async function getPdfStats(filePath: string): Promise<{
  pages: number
  fileSizeBytes: number
  isEncrypted: boolean
}> {
  validateFile(filePath)
  const bytes = fs.readFileSync(filePath)
  const stat = fs.statSync(filePath)

  let pages = 0
  let isEncrypted = false
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
    pages = doc.getPageCount()
  } catch {
    isEncrypted = true
  }

  return { pages, fileSizeBytes: stat.size, isEncrypted }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateFile(filePath: string): void {
  if (!fs.existsSync(filePath)) throw new Error(`FILE_IO: not found: ${filePath}`)
  const stat = fs.statSync(filePath)
  if (stat.size > 500 * 1024 * 1024) throw new Error('LIMIT_EXCEEDED: file > 500 MB')
}
