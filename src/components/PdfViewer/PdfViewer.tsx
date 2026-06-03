import { useState, useEffect, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, TextItem } from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import './PdfViewer.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// One edit = one text item replaced
interface TextEdit {
  pageNum: number
  itemIndex: number
  original: string
  replacement: string
  x: number; y: number; w: number; h: number
  fontSize: number
}

interface Props {
  pdfPath: string
  documentId: string
  currentPage?: number
  onPageChange?: (page: number) => void
  onPageCount?: (count: number) => void
}

export default function PdfViewer({ pdfPath, currentPage = 1, onPageChange, onPageCount }: Props) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [activePage, setActivePage] = useState(currentPage)
  const [zoom, setZoom] = useState(1.2)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<TextEdit[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const containerRef = useRef<HTMLDivElement>(null)
  const renderedPages = useRef<Set<number>>(new Set())

  // Load PDF
  useEffect(() => {
    if (!pdfPath) return
    setLoading(true); setError(null); setPdfDoc(null)
    renderedPages.current.clear()
    setEdits([])

    window.fileApi.read(pdfPath).then(async ({ base64 }: { base64: string }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      setPdfBytes(bytes)
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise
      setPdfDoc(doc)
      setPageCount(doc.numPages)
      onPageCount?.(doc.numPages)
      setActivePage(1)
    }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load PDF'))
      .finally(() => setLoading(false))
  }, [pdfPath])

  // Render a single page (canvas + text layer)
  const renderPage = useCallback(async (doc: PDFDocumentProxy, pageNum: number, container: HTMLDivElement) => {
    const page: PDFPageProxy = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale: zoom * window.devicePixelRatio })
    const displayVp = page.getViewport({ scale: zoom })

    // Canvas layer
    const canvas = container.querySelector<HTMLCanvasElement>('canvas')!
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${displayVp.width}px`
    canvas.style.height = `${displayVp.height}px`
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise

    // Text layer — positioned spans that users can select/click
    const textLayerDiv = container.querySelector<HTMLDivElement>('.pdf-text-layer')!
    textLayerDiv.style.width = `${displayVp.width}px`
    textLayerDiv.style.height = `${displayVp.height}px`
    textLayerDiv.innerHTML = ''

    const textContent = await page.getTextContent()
    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: textContent as Parameters<typeof pdfjsLib.TextLayer>[0]['textContentSource'],
      container: textLayerDiv,
      viewport: displayVp,
    })
    await textLayer.render()

    // Make each span double-clickable to start editing
    const spans = textLayerDiv.querySelectorAll<HTMLSpanElement>('span[role="presentation"], span')
    spans.forEach((span, idx) => {
      span.dataset.pageNum = String(pageNum)
      span.dataset.itemIdx = String(idx)
      span.title = 'Double-click to edit'
    })

    page.cleanup()
  }, [zoom])

  // Re-render all visible pages when zoom changes
  useEffect(() => {
    if (!pdfDoc) return
    renderedPages.current.forEach((pageNum) => {
      const container = containerRef.current?.querySelector<HTMLDivElement>(`[data-page="${pageNum}"] .pdf-page-inner`)
      if (container) renderPage(pdfDoc, pageNum, container)
    })
  }, [zoom, pdfDoc, renderPage])

  // Intersection observer: render pages lazily as they scroll into view
  useEffect(() => {
    if (!pdfDoc || !containerRef.current) return
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        const wrapper = entry.target as HTMLElement
        const pageNum = Number(wrapper.dataset.page)
        if (renderedPages.current.has(pageNum)) return
        renderedPages.current.add(pageNum)
        const inner = wrapper.querySelector<HTMLDivElement>('.pdf-page-inner')
        if (inner) renderPage(pdfDoc, pageNum, inner)
      })
    }, { root: containerRef.current, rootMargin: '200px' })

    const wrappers = containerRef.current.querySelectorAll('[data-page]')
    wrappers.forEach((w) => observer.observe(w))
    return () => observer.disconnect()
  }, [pdfDoc, renderPage, pageCount])

  // Track scroll → update active page
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const wrappers = container.querySelectorAll<HTMLElement>('[data-page]')
    let nearest = activePage
    let minDist = Infinity
    wrappers.forEach((el) => {
      const d = Math.abs(el.offsetTop - container.scrollTop - container.clientHeight / 4)
      if (d < minDist) { minDist = d; nearest = Number(el.dataset.page) }
    })
    if (nearest !== activePage) { setActivePage(nearest); onPageChange?.(nearest) }
  }, [activePage, onPageChange])

  const scrollTo = (p: number) => {
    containerRef.current?.querySelector<HTMLElement>(`[data-page="${p}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Double-click on text layer → enter edit mode
  const handleTextLayerDblClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>, pageNum: number) => {
    const span = (e.target as HTMLElement).closest('span') as HTMLSpanElement | null
    if (!span || !pdfDoc) return
    e.preventDefault()
    e.stopPropagation()

    const itemIdx = Number(span.dataset.itemIdx ?? 0)
    const key = `${pageNum}-${itemIdx}`
    setEditingKey(key)

    // Store original text for edit tracking
    const existing = edits.find((ed) => ed.pageNum === pageNum && ed.itemIndex === itemIdx)
    const originalText = existing?.original ?? span.textContent ?? ''

    const rect = span.getBoundingClientRect()
    const parentRect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = rect.left - parentRect.left
    const y = rect.top - parentRect.top

    // Make span contenteditable inline
    span.contentEditable = 'true'
    span.style.outline = '2px solid #0066cc'
    span.style.backgroundColor = 'rgba(0,102,204,0.08)'
    span.style.cursor = 'text'
    span.focus()

    // Select all text in the span
    const range = document.createRange()
    range.selectNodeContents(span)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)

    const commit = () => {
      const newText = span.textContent ?? ''
      span.contentEditable = 'false'
      span.style.outline = ''
      span.style.backgroundColor = ''
      span.style.cursor = ''
      setEditingKey(null)

      if (newText !== originalText) {
        setEdits((prev) => {
          const filtered = prev.filter((ed) => !(ed.pageNum === pageNum && ed.itemIndex === itemIdx))
          return [...filtered, {
            pageNum, itemIndex: itemIdx,
            original: originalText, replacement: newText,
            x, y,
            w: rect.width / zoom,
            h: rect.height / zoom,
            fontSize: parseFloat(getComputedStyle(span).fontSize) / zoom,
          }]
        })
      }
    }

    span.addEventListener('blur', commit, { once: true })
    span.addEventListener('keydown', (ke: KeyboardEvent) => {
      if (ke.key === 'Escape') { span.textContent = originalText; span.blur() }
      if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); span.blur() }
    })
  }, [pdfDoc, edits, zoom])

  // Save edits back to PDF using pdf-lib overlay
  const handleSave = useCallback(async () => {
    if (!pdfBytes || edits.length === 0) return
    setSaveStatus('saving')

    try {
      const doc = await PDFDocument.load(pdfBytes)
      const helvetica = await doc.embedFont(StandardFonts.Helvetica)

      for (const edit of edits) {
        const page = doc.getPage(edit.pageNum - 1)
        const { height } = page.getSize()

        // White-out the original text region
        page.drawRectangle({
          x: edit.x,
          y: height - edit.y - edit.h - 4,
          width: edit.w + 20,
          height: edit.h + 4,
          color: rgb(1, 1, 1),
          opacity: 1,
        })

        // Draw replacement text
        const fs = Math.max(6, Math.min(edit.fontSize, 72))
        page.drawText(edit.replacement, {
          x: edit.x,
          y: height - edit.y - edit.h + 1,
          size: fs,
          font: helvetica,
          color: rgb(0, 0, 0),
        })
      }

      const saved = await doc.save()
      const b64 = btoa(String.fromCharCode(...saved))

      const savePath = await window.fileApi.saveDialog(
        pdfPath.replace(/\.pdf$/i, '_edited.pdf')
      )
      if (!savePath) { setSaveStatus('idle'); return }

      await window.fileApi.write(savePath, b64)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch (err) {
      console.error(err)
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }, [pdfBytes, edits, pdfPath])

  if (loading) return (
    <div className="pdf-loading" role="status">
      <div className="pdf-spinner" aria-hidden="true" />
      Loading PDF…
    </div>
  )
  if (error) return (
    <div className="pdf-error" role="alert">
      <strong>Could not open PDF</strong>
      <p>{error}</p>
    </div>
  )
  if (!pdfDoc) return null

  return (
    <div className="pdf-viewer-shell">
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF viewer controls">
        {/* Page nav */}
        <div className="pdf-nav">
          <button onClick={() => { const p = Math.max(1, activePage - 1); setActivePage(p); scrollTo(p); onPageChange?.(p) }} disabled={activePage <= 1} aria-label="Previous page">‹</button>
          <span className="pdf-page-indicator">
            <input type="number" value={activePage} min={1} max={pageCount}
              onChange={(e) => { const p = Math.max(1, Math.min(pageCount, Number(e.target.value))); setActivePage(p); scrollTo(p); onPageChange?.(p) }}
              aria-label="Current page" />
            <span>/ {pageCount}</span>
          </span>
          <button onClick={() => { const p = Math.min(pageCount, activePage + 1); setActivePage(p); scrollTo(p); onPageChange?.(p) }} disabled={activePage >= pageCount} aria-label="Next page">›</button>
        </div>

        {/* Zoom */}
        <div className="pdf-zoom">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Zoom out">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))} aria-label="Zoom in">+</button>
          <button onClick={() => setZoom(1.2)} className="btn-zoom-reset" aria-label="Reset zoom">Fit</button>
        </div>

        {/* Edit hint + save */}
        <div className="pdf-edit-tools">
          <span className="pdf-edit-hint">Double-click any text to edit</span>
          {editingKey && <span className="pdf-editing-badge">✏ Editing…</span>}
          {edits.length > 0 && (
            <button
              onClick={handleSave}
              disabled={saveStatus === 'saving'}
              className="btn-save"
              aria-label="Save edited PDF"
            >
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? '✗ Error' : `💾 Save (${edits.length} edit${edits.length > 1 ? 's' : ''})`}
            </button>
          )}
        </div>
      </div>

      {edits.length > 0 && (
        <div className="pdf-edits-bar" role="status">
          {edits.length} unsaved edit{edits.length > 1 ? 's' : ''} — click Save to export as a new PDF
          <button onClick={() => setEdits([])} className="btn-sm-plain" aria-label="Discard all edits">Discard all</button>
        </div>
      )}

      <div
        className="pdf-pages-container"
        ref={containerRef}
        onScroll={handleScroll}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { const p = Math.min(pageCount, activePage + 1); setActivePage(p); scrollTo(p); onPageChange?.(p) }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { const p = Math.max(1, activePage - 1); setActivePage(p); scrollTo(p); onPageChange?.(p) }
        }}
        aria-label="PDF document"
        role="document"
      >
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
          <div key={pageNum} className={`pdf-page-wrapper ${activePage === pageNum ? 'active' : ''}`} data-page={pageNum}>
            <div className="pdf-page-label" aria-hidden="true">Page {pageNum}</div>
            <div
              className="pdf-page-inner"
              role="img"
              aria-label={`Page ${pageNum} of ${pageCount}`}
            >
              <canvas className="pdf-canvas" />
              <div
                className="pdf-text-layer"
                onDoubleClick={(e) => handleTextLayerDblClick(e, pageNum)}
                aria-label={`Text content of page ${pageNum}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
