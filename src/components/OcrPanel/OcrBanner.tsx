import { useState, useEffect } from 'react'
import { useOcrProcessor } from '../../hooks/useOcrProcessor'
import type { OcrPageResult } from '../../hooks/useOcrProcessor'
import LanguageSelector from './LanguageSelector'
import './OcrPanel.css'

interface Props {
  documentId: string
  pdfPath: string
  totalPages: number          // passed from the viewer so we know the full range
  currentPage: number
  onTextMerged?: (wordCount: number) => void
}

type Mode = 'banner' | 'options' | 'running' | 'done'
type PageRange = 'all' | 'current' | 'range'

export default function OcrBanner({ documentId, pdfPath, totalPages, currentPage, onTextMerged }: Props) {
  const [mode, setMode] = useState<Mode>('banner')
  const [dismissed, setDismissed] = useState(false)
  const [languages] = useState<string[]>(['eng'])   // language selection — future: pass to worker
  const [pageRange, setPageRange] = useState<PageRange>('all')
  const [customRange, setCustomRange] = useState('')
  const [showHighlights, setShowHighlights] = useState(true)

  const { progress, start, cancel } = useOcrProcessor()

  // Transition mode when OCR finishes
  useEffect(() => {
    if (progress?.complete) setMode('done')
  }, [progress?.complete])

  if (dismissed && mode !== 'running' && mode !== 'done') return null

  const resolvePageNums = (): number[] => {
    if (pageRange === 'current') return [currentPage]
    if (pageRange === 'all') return Array.from({ length: totalPages }, (_, i) => i + 1)
    // parse custom range like "1-3,5,8-10"
    const nums: number[] = []
    const seen = new Set<number>()
    for (const token of customRange.split(',').map((t) => t.trim()).filter(Boolean)) {
      if (token.includes('-')) {
        const [a, b] = token.split('-').map(Number)
        for (let i = Math.max(1, a); i <= Math.min(totalPages, b); i++) {
          if (!seen.has(i)) { seen.add(i); nums.push(i) }
        }
      } else {
        const n = Number(token)
        if (n >= 1 && n <= totalPages && !seen.has(n)) { seen.add(n); nums.push(n) }
      }
    }
    return nums
  }

  const handleStart = () => {
    const pages = resolvePageNums()
    if (!pages.length) return
    setMode('running')
    start(pdfPath, pages)
  }

  const handleMergeText = () => {
    if (!progress?.pages) return
    const combined = progress.pages
      .filter((p) => p.status === 'done')
      .map((p) => p.text)
      .join('\n\n')
    const wordCount = combined.split(/\s+/).filter(Boolean).length
    onTextMerged?.(wordCount)
  }

  const donePages = progress?.pages.filter((p) => p.status === 'done') ?? []
  const failedPages = progress?.pages.filter((p) => p.status === 'failed') ?? []
  const avgConf = donePages.length
    ? Math.round(donePages.reduce((s, p) => s + p.confidence, 0) / donePages.length)
    : 0

  // ── Banner (initial prompt) ────────────────────────────────────────────────
  if (mode === 'banner') return (
    <div className="ocr-banner" role="alert">
      <span className="ocr-banner-icon" aria-hidden="true">🔍</span>
      <span>Make this PDF searchable with OCR.</span>
      <span className="ocr-privacy-note" title="Processing occurs on-device">🔒 On-device</span>
      <div className="ocr-banner-actions">
        <button onClick={handleStart} className="btn-primary">Run OCR</button>
        <button onClick={() => setMode('options')}>Options</button>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss">Skip</button>
      </div>
    </div>
  )

  // ── Options ────────────────────────────────────────────────────────────────
  if (mode === 'options') return (
    <div className="ocr-banner ocr-options">
      <h3>OCR Options</h3>

      <LanguageSelector selected={languages} onChange={() => {}} />

      <div className="ocr-option-field">
        <label><strong>Pages to process</strong></label>
        <label>
          <input type="radio" checked={pageRange === 'all'} onChange={() => setPageRange('all')} />
          {' '}All pages ({totalPages})
        </label>
        <label>
          <input type="radio" checked={pageRange === 'current'} onChange={() => setPageRange('current')} />
          {' '}Current page only (page {currentPage})
        </label>
        <label>
          <input type="radio" checked={pageRange === 'range'} onChange={() => setPageRange('range')} />
          {' '}Specific pages
        </label>
        {pageRange === 'range' && (
          <input
            type="text"
            placeholder="e.g. 1-3, 5, 8-10"
            value={customRange}
            onChange={(e) => setCustomRange(e.target.value)}
            className="ocr-range-input"
            aria-label="Page range"
          />
        )}
        {pageRange === 'range' && customRange && (
          <span className="ocr-range-preview">
            → pages: {resolvePageNums().join(', ') || 'none'}
          </span>
        )}
      </div>

      <div className="ocr-option-actions">
        <button onClick={() => setMode('banner')}>Back</button>
        <button
          onClick={handleStart}
          disabled={pageRange === 'range' && resolvePageNums().length === 0}
          className="btn-primary"
        >
          Start OCR ({resolvePageNums().length} page{resolvePageNums().length !== 1 ? 's' : ''})
        </button>
      </div>
    </div>
  )

  // ── Running ────────────────────────────────────────────────────────────────
  if (mode === 'running' && progress) return (
    <div className="ocr-progress-panel" role="region" aria-label="OCR progress" aria-live="polite">
      <div className="ocr-progress-header">
        <span className="ocr-progress-title">
          Processing page {progress.done + 1} of {progress.total}…
        </span>
        <button onClick={cancel} className="btn-warning btn-sm" aria-label="Cancel OCR">Cancel</button>
      </div>

      <div className="ocr-progress-bar-wrap" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="ocr-progress-bar" style={{ width: `${progress.pct}%` }} />
      </div>
      <div className="ocr-progress-stats">
        <span>{progress.done} / {progress.total} pages</span>
        <span>{progress.pct}%</span>
      </div>

      <div className="ocr-page-list" role="list">
        {progress.pages.map((p) => (
          <OcrPageRow key={p.page} page={p} />
        ))}
      </div>
    </div>
  )

  // ── Done ───────────────────────────────────────────────────────────────────
  if (mode === 'done' && progress) return (
    <div className="ocr-results-bar" role="status" aria-live="polite">
      <span>
        ✓ OCR complete — {donePages.length} page{donePages.length !== 1 ? 's' : ''} processed
        {avgConf > 0 && ` · ${avgConf}% avg confidence`}
        {failedPages.length > 0 && ` · ${failedPages.length} failed`}
      </span>

      <button onClick={() => setShowHighlights((v) => !v)} className="btn-sm">
        {showHighlights ? 'Hide' : 'Show'} results
      </button>

      {showHighlights && donePages.length > 0 && (
        <button onClick={handleMergeText} className="btn-sm btn-primary">
          Import text into document
        </button>
      )}

      <button onClick={() => { setMode('options'); setDismissed(false) }} className="btn-sm">
        Re-run…
      </button>

      <button onClick={() => setDismissed(true)} className="btn-sm" aria-label="Dismiss results">
        ✕
      </button>

      {showHighlights && (
        <div className="ocr-results-text-list">
          {donePages.map((p) => (
            <div key={p.page} className="ocr-result-page">
              <div className="ocr-result-page-header">
                Page {p.page}
                <span className={`ocr-conf-badge ${p.confidence >= 70 ? 'good' : p.confidence >= 40 ? 'medium' : 'low'}`}>
                  {p.confidence}%
                </span>
              </div>
              <pre className="ocr-result-text">{p.text || '(no text detected)'}</pre>
            </div>
          ))}
          {failedPages.map((p) => (
            <div key={p.page} className="ocr-result-page ocr-result-failed">
              <div className="ocr-result-page-header">Page {p.page} — failed: {p.error}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return null
}

function OcrPageRow({ page }: { page: OcrPageResult }) {
  const icons: Record<string, string> = {
    queued: '⏳', rendering: '🖼', processing: '⚙️', done: '✓', skipped: '–', failed: '✗',
  }
  return (
    <div className={`ocr-page-row ocr-status-${page.status}`} role="listitem">
      <span className="ocr-page-icon" aria-hidden="true">{icons[page.status] ?? '?'}</span>
      <span>Page {page.page}</span>
      <span className="ocr-page-status">{page.status}</span>
      {page.status === 'done' && page.confidence > 0 && (
        <span className={`ocr-conf-badge ${page.confidence >= 70 ? 'good' : page.confidence >= 40 ? 'medium' : 'low'}`}>
          {page.confidence}%
        </span>
      )}
    </div>
  )
}
