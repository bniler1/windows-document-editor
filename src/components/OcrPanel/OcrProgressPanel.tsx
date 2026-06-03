import type { OcrJobProgress } from '../../types'
import './OcrPanel.css'

interface Props {
  progress: OcrJobProgress
  onCancel: () => void
  onClose: () => void
}

const statusLabel: Record<string, string> = {
  queued: '⏳',
  processing: '⚙️',
  completed: '✓',
  failed: '✗',
  skipped: '–',
}

export default function OcrProgressPanel({ progress, onCancel, onClose }: Props) {
  const { pagesTotal, pagesProcessed } = progress.progress
  const pct = pagesTotal > 0 ? Math.round((pagesProcessed / pagesTotal) * 100) : 0
  const isDone = ['completed', 'failed', 'canceled', 'partial'].includes(progress.status)

  return (
    <div className="ocr-progress-panel" role="region" aria-label="OCR progress" aria-live="polite">
      <div className="ocr-progress-header">
        <span className="ocr-progress-title">
          {isDone ? 'OCR Complete' : 'Running OCR…'}
        </span>
        <button onClick={onClose} aria-label="Close panel" className="ocr-close-btn">
          ×
        </button>
      </div>

      <div className="ocr-progress-bar-wrap" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="ocr-progress-bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="ocr-progress-stats">
        <span>{pagesProcessed} / {pagesTotal} pages</span>
        <span>{pct}%</span>
      </div>

      <div className="ocr-page-list" role="list" aria-label="Per-page status">
        {progress.perPage.map((p) => (
          <div key={p.page} className={`ocr-page-row ocr-status-${p.status}`} role="listitem">
            <span className="ocr-page-icon" aria-hidden="true">
              {statusLabel[p.status] ?? '?'}
            </span>
            <span>Page {p.page}</span>
            <span className="ocr-page-status">{p.status}</span>
          </div>
        ))}
      </div>

      {!isDone && (
        <div className="ocr-progress-actions">
          <button onClick={onCancel} className="btn-warning">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
