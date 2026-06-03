import { useState, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export type OcrPageStatus = 'queued' | 'rendering' | 'processing' | 'done' | 'skipped' | 'failed'

export interface OcrPageResult {
  page: number
  status: OcrPageStatus
  text: string
  confidence: number   // 0–100
  error?: string
}

export interface OcrProgress {
  total: number
  done: number
  pct: number
  pages: OcrPageResult[]
  running: boolean
  complete: boolean
  error: string | null
}

interface UseOcrProcessorReturn {
  progress: OcrProgress | null
  start: (pdfPath: string, pageNums: number[]) => void
  cancel: () => void
}

const RENDER_SCALE = 2.0   // 150 DPI equivalent — good accuracy, reasonable speed
const RENDER_TIMEOUT_MS = 30_000

export function useOcrProcessor(): UseOcrProcessorReturn {
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const cancelRef = useRef(false)

  const start = useCallback(async (pdfPath: string, pageNums: number[]) => {
    if (!pageNums.length) return

    cancelRef.current = false

    const initial: OcrPageResult[] = pageNums.map((n) => ({
      page: n, status: 'queued', text: '', confidence: 0,
    }))

    setProgress({ total: pageNums.length, done: 0, pct: 0, pages: initial, running: true, complete: false, error: null })

    try {
      // Load PDF in renderer (pdfjs-dist is already initialized in PdfViewer)
      const { base64 } = await window.fileApi.read(pdfPath)
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const pdfDoc: PDFDocumentProxy = await pdfjsLib.getDocument({ data: bytes }).promise

      // Dynamically import Tesseract.js (browser build)
      const Tesseract = await import('tesseract.js')
      const worker = await Tesseract.createWorker('eng')

      let doneCount = 0

      for (const pageNum of pageNums) {
        if (cancelRef.current) break

        // Mark rendering
        setProgress((prev) => prev ? updatePage(prev, pageNum, { status: 'rendering' }) : prev)

        try {
          // Render page to offscreen canvas
          const dataUrl = await renderPageToDataUrl(pdfDoc, pageNum)

          if (cancelRef.current) break

          // Mark OCR processing
          setProgress((prev) => prev ? updatePage(prev, pageNum, { status: 'processing' }) : prev)

          // Run Tesseract
          const result = await Promise.race([
            worker.recognize(dataUrl),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), RENDER_TIMEOUT_MS)),
          ]) as Awaited<ReturnType<typeof worker.recognize>>

          doneCount++
          const text = result.data.text.trim()
          const confidence = result.data.confidence

          setProgress((prev) => prev ? {
            ...updatePage(prev, pageNum, { status: 'done', text, confidence }),
            done: doneCount,
            pct: Math.round((doneCount / pageNums.length) * 100),
          } : prev)
        } catch (err) {
          doneCount++
          const msg = err instanceof Error ? err.message : String(err)
          setProgress((prev) => prev ? {
            ...updatePage(prev, pageNum, { status: 'failed', error: msg }),
            done: doneCount,
            pct: Math.round((doneCount / pageNums.length) * 100),
          } : prev)
        }
      }

      worker.terminate()
      pdfDoc.destroy()

      setProgress((prev) => prev ? { ...prev, running: false, complete: true } : prev)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setProgress((prev) => prev ? { ...prev, running: false, complete: true, error: msg } : prev)
    }
  }, [])

  const cancel = useCallback(() => {
    cancelRef.current = true
    setProgress((prev) => prev ? { ...prev, running: false, complete: true } : prev)
  }, [])

  return { progress, start, cancel }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderPageToDataUrl(pdfDoc: PDFDocumentProxy, pageNum: number): Promise<string> {
  const page = await pdfDoc.getPage(pageNum)
  const viewport = page.getViewport({ scale: RENDER_SCALE })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const ctx = canvas.getContext('2d')!
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
  page.cleanup()

  return canvas.toDataURL('image/png')
}

function updatePage(prev: OcrProgress, pageNum: number, patch: Partial<OcrPageResult>): OcrProgress {
  return {
    ...prev,
    pages: prev.pages.map((p) => p.page === pageNum ? { ...p, ...patch } : p),
  }
}
