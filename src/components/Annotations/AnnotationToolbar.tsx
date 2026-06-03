import { useState } from 'react'
import './Annotations.css'

type Tool = 'highlight' | 'comment' | 'redaction' | 'watermark' | null

interface Props {
  documentId: string
  pdfPath: string | null
  activePage: number
  onAnnotationAdded?: () => void
}

const HIGHLIGHT_COLORS = ['#ffff00', '#a8f0a0', '#ffd0a0', '#b0c8ff', '#ffa0a0']

export default function AnnotationToolbar({ documentId, pdfPath, activePage, onAnnotationAdded }: Props) {
  const [activeTool, setActiveTool] = useState<Tool>(null)
  const [highlightColor, setHighlightColor] = useState('#ffff00')
  const [commentText, setCommentText] = useState('')
  const [watermarkText, setWatermarkText] = useState('DRAFT')
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.3)
  const [watermarkColor, setWatermarkColor] = useState('#cccccc')
  const [status, setStatus] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const showStatus = (msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(null), 3000)
  }

  const handleHighlight = async (bounds: { x: number; y: number; width: number; height: number }) => {
    await window.annApi.add(documentId, activePage, 'highlight', bounds, { color: highlightColor })
    onAnnotationAdded?.()
    showStatus('Highlight added')
  }

  const handleAddComment = async () => {
    if (!commentText.trim()) return
    await window.annApi.add(documentId, activePage, 'comment', { x: 20, y: 20, width: 200, height: 50 }, {
      content: commentText.trim(),
      color: '#fff9c4',
    })
    setCommentText('')
    onAnnotationAdded?.()
    showStatus('Comment added')
  }

  const handleApplyWatermark = async () => {
    await window.annApi.upsertWatermark({
      documentId,
      type: 'text',
      content: watermarkText,
      opacity: watermarkOpacity,
      color: watermarkColor,
      position: 'diagonal',
    })
    showStatus('Watermark saved')
  }

  const handleExportWatermarked = async () => {
    if (!pdfPath) return
    setRunning(true)
    try {
      const wm = await window.annApi.getWatermark(documentId)
      if (!wm) { showStatus('No watermark configured'); return }
      const out = await window.annApi.applyWatermark(pdfPath, wm)
      if (out) showStatus(`Saved: ${out}`)
    } finally {
      setRunning(false)
    }
  }

  const handleApplyRedactions = async () => {
    if (!pdfPath) return
    setRunning(true)
    try {
      const res = await window.annApi.applyRedactions(pdfPath, documentId)
      if (res) showStatus(`Redacted ${res.redactedCount} area(s) → ${res.outputPath}`)
    } finally {
      setRunning(false)
    }
  }

  const handleFlattenAnnotations = async () => {
    if (!pdfPath) return
    setRunning(true)
    try {
      const res = await window.annApi.flattenAnnotations(pdfPath, documentId)
      if (res) showStatus(`Flattened ${res.annotationsFlattenned} annotation(s) → ${res.outputPath}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="ann-toolbar" role="toolbar" aria-label="Annotation tools">
      <div className="ann-tool-buttons">
        <button
          className={activeTool === 'highlight' ? 'active' : ''}
          onClick={() => setActiveTool(activeTool === 'highlight' ? null : 'highlight')}
          title="Highlight"
          aria-pressed={activeTool === 'highlight'}
        >
          🖊 Highlight
        </button>
        <button
          className={activeTool === 'comment' ? 'active' : ''}
          onClick={() => setActiveTool(activeTool === 'comment' ? null : 'comment')}
          title="Add comment"
          aria-pressed={activeTool === 'comment'}
        >
          💬 Comment
        </button>
        <button
          className={activeTool === 'redaction' ? 'active' : ''}
          onClick={() => setActiveTool(activeTool === 'redaction' ? null : 'redaction')}
          title="Mark for redaction"
          aria-pressed={activeTool === 'redaction'}
        >
          ⬛ Redact
        </button>
        <button
          className={activeTool === 'watermark' ? 'active' : ''}
          onClick={() => setActiveTool(activeTool === 'watermark' ? null : 'watermark')}
          title="Watermark"
          aria-pressed={activeTool === 'watermark'}
        >
          🔖 Watermark
        </button>
      </div>

      {activeTool === 'highlight' && (
        <div className="ann-options" role="group" aria-label="Highlight options">
          <span>Color:</span>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              className={`color-swatch ${highlightColor === c ? 'selected' : ''}`}
              style={{ background: c }}
              onClick={() => setHighlightColor(c)}
              aria-label={`Highlight color ${c}`}
              aria-pressed={highlightColor === c}
            />
          ))}
          <button
            onClick={() => handleHighlight({ x: 50, y: 100, width: 200, height: 20 })}
            className="btn-sm btn-apply"
          >
            Add highlight on page {activePage}
          </button>
        </div>
      )}

      {activeTool === 'comment' && (
        <div className="ann-options" role="group" aria-label="Comment options">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Enter comment text…"
            rows={3}
            maxLength={10000}
            aria-label="Comment text"
          />
          <button onClick={handleAddComment} disabled={!commentText.trim()} className="btn-sm btn-apply">
            Add comment
          </button>
        </div>
      )}

      {activeTool === 'redaction' && (
        <div className="ann-options" role="group" aria-label="Redaction options">
          <p className="ann-hint">Marks a black-box area on the current page for redaction. Apply to permanently burn into PDF.</p>
          <button
            onClick={() => window.annApi.add(documentId, activePage, 'redaction', { x: 50, y: 100, width: 150, height: 20 })}
            className="btn-sm btn-redact"
          >
            Mark area on page {activePage}
          </button>
          <button onClick={handleApplyRedactions} disabled={running || !pdfPath} className="btn-sm btn-danger-action">
            {running ? 'Applying…' : 'Apply redactions → save PDF'}
          </button>
        </div>
      )}

      {activeTool === 'watermark' && (
        <div className="ann-options" role="group" aria-label="Watermark options">
          <label htmlFor="wm-text">Text</label>
          <input id="wm-text" value={watermarkText} onChange={(e) => setWatermarkText(e.target.value)} aria-label="Watermark text" />

          <label htmlFor="wm-opacity">Opacity: {Math.round(watermarkOpacity * 100)}%</label>
          <input
            id="wm-opacity"
            type="range" min={0.05} max={0.9} step={0.05}
            value={watermarkOpacity}
            onChange={(e) => setWatermarkOpacity(Number(e.target.value))}
            aria-label="Watermark opacity"
          />

          <label htmlFor="wm-color">Color</label>
          <input id="wm-color" type="color" value={watermarkColor} onChange={(e) => setWatermarkColor(e.target.value)} aria-label="Watermark color" />

          <div className="ann-action-row">
            <button onClick={handleApplyWatermark} className="btn-sm btn-apply">Save watermark</button>
            <button onClick={handleExportWatermarked} disabled={running || !pdfPath} className="btn-sm">
              {running ? 'Exporting…' : 'Export watermarked PDF'}
            </button>
          </div>
        </div>
      )}

      {/* Export actions always visible */}
      <div className="ann-export-row">
        <button onClick={handleFlattenAnnotations} disabled={running || !pdfPath} className="btn-sm">
          Flatten highlights → PDF
        </button>
      </div>

      {status && (
        <div className="ann-status" role="status" aria-live="polite">{status}</div>
      )}
    </div>
  )
}
