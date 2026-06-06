import { useState, useEffect } from 'react'
import './PdfImport.css'

interface ImportOptions {
  pageRangeAll: boolean
  pageStart: number
  pageEnd: number
  preservePageBreaks: boolean
  detectLists: boolean
  reconstructTables: boolean
  ocrEnabled: boolean
  mode: 'EditableFlow' | 'ExactLayout'
}

interface Progress {
  jobId: string; status: string; done: number; total: number; pct: number; message: string
}

interface Props {
  pdfPath?: string
  onComplete: (html: string, jobId: string) => void
  onClose: () => void
}

export default function ImportPdfDialog({ pdfPath: initialPath, onComplete, onClose }: Props) {
  const [step, setStep] = useState<'options' | 'password' | 'progress' | 'done' | 'error'>('options')
  const [pdfPath, setPdfPath] = useState(initialPath ?? '')
  const [password, setPassword] = useState('')
  const [passwordAttempts, setPasswordAttempts] = useState(0)
  const [opts, setOpts] = useState<ImportOptions>({
    pageRangeAll: true, pageStart: 1, pageEnd: 999,
    preservePageBreaks: true, detectLists: true, reconstructTables: true,
    ocrEnabled: false, mode: 'EditableFlow',
  })
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<{ html: string; jobId: string; anomalies: Array<{ severity: string; code: string; message: string }> } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showReport, setShowReport] = useState(false)
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)

  // Listen to import progress from main process
  useEffect(() => {
    const cleanup = (window as unknown as { pdfImportApi: { onProgress: (cb: (d: unknown) => void) => () => void } })
      .pdfImportApi.onProgress((data: unknown) => {
        const d = data as Progress
        setProgress(d)
        if (d.status === 'SUCCEEDED') setStep('done')
        if (d.status === 'FAILED') { setStep('error'); setErrorMsg('Import failed') }
      })
    return cleanup
  }, [])

  const pickFile = async () => {
    const [p] = await window.pdfApi.pickFiles()
    if (p) setPdfPath(p)
  }

  const startImport = async (pwd?: string) => {
    if (!pdfPath) return
    setStep('progress')
    setProgress({ jobId: '', status: 'RUNNING', done: 0, total: 0, pct: 0, message: 'Starting…' })

    try {
      const api = (window as unknown as { pdfImportApi: { start: (r: unknown) => Promise<unknown> } }).pdfImportApi
      const res = await api.start({
        pdfPath,
        password: pwd,
        mode: opts.mode,
        pageRange: opts.pageRangeAll ? undefined : { start: opts.pageStart, end: opts.pageEnd },
        ocrEnabled: opts.ocrEnabled,
        preservePageBreaks: opts.preservePageBreaks,
        detectLists: opts.detectLists,
        reconstructTables: opts.reconstructTables,
      }) as { html: string; jobId: string; anomalies: Array<{ severity: string; code: string; message: string }> } | null

      if (!res) { setStep('options'); return }
      setResult(res)
      setCurrentJobId(res.jobId)
      setStep('done')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'NEEDS_PASSWORD') {
        setPasswordAttempts(a => a + 1)
        if (passwordAttempts >= 2) {
          setStep('error'); setErrorMsg('Incorrect password after 3 attempts. Import aborted.')
        } else {
          setStep('password')
        }
        return
      }
      setStep('error')
      setErrorMsg(msg)
    }
  }

  const handlePasswordSubmit = () => startImport(password)

  const handleCancel = () => {
    if (currentJobId) {
      (window as unknown as { pdfImportApi: { cancel: (id: string) => void } }).pdfImportApi.cancel(currentJobId)
    }
    onClose()
  }

  return (
    <div className="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="import-dialog">
        <div className="import-header">
          <h2 id="import-title">Import PDF</h2>
          <button onClick={onClose} aria-label="Close" className="import-close">✕</button>
        </div>

        {/* ── Options ── */}
        {step === 'options' && (
          <div className="import-body">
            {!initialPath && (
              <div className="import-field">
                <label>PDF File</label>
                <div className="import-file-row">
                  <span className="import-file-name">{pdfPath || 'No file selected'}</span>
                  <button onClick={pickFile} className="btn-sm">Browse…</button>
                </div>
              </div>
            )}

            <div className="import-field">
              <label>Import mode</label>
              <select value={opts.mode} onChange={e => setOpts(o => ({ ...o, mode: e.target.value as ImportOptions['mode'] }))} aria-label="Import mode">
                <option value="EditableFlow">Editable Flow (default — best for editing)</option>
                <option value="ExactLayout">Exact Layout (preserves positioning)</option>
              </select>
            </div>

            <div className="import-field">
              <label>Pages</label>
              <label><input type="radio" checked={opts.pageRangeAll} onChange={() => setOpts(o => ({...o, pageRangeAll: true}))} /> All pages</label>
              <label><input type="radio" checked={!opts.pageRangeAll} onChange={() => setOpts(o => ({...o, pageRangeAll: false}))} /> Range:</label>
              {!opts.pageRangeAll && (
                <div className="import-range-row">
                  <input type="number" value={opts.pageStart} min={1} onChange={e => setOpts(o => ({...o, pageStart: Number(e.target.value)}))} aria-label="Start page" />
                  <span>to</span>
                  <input type="number" value={opts.pageEnd} min={1} onChange={e => setOpts(o => ({...o, pageEnd: Number(e.target.value)}))} aria-label="End page" />
                </div>
              )}
            </div>

            <div className="import-field import-checkboxes">
              <label><input type="checkbox" checked={opts.preservePageBreaks} onChange={e => setOpts(o => ({...o, preservePageBreaks: e.target.checked}))} /> Preserve page breaks</label>
              <label><input type="checkbox" checked={opts.detectLists} onChange={e => setOpts(o => ({...o, detectLists: e.target.checked}))} /> Detect lists &amp; numbering</label>
              <label><input type="checkbox" checked={opts.reconstructTables} onChange={e => setOpts(o => ({...o, reconstructTables: e.target.checked}))} /> Reconstruct tables</label>
              <label><input type="checkbox" checked={opts.ocrEnabled} onChange={e => setOpts(o => ({...o, ocrEnabled: e.target.checked}))} /> Enable OCR for scanned pages</label>
            </div>

            <div className="import-actions">
              <button onClick={onClose} className="btn-cancel">Cancel</button>
              <button onClick={() => startImport()} disabled={!pdfPath} className="btn-primary-action">Import PDF</button>
            </div>
          </div>
        )}

        {/* ── Password ── */}
        {step === 'password' && (
          <div className="import-body">
            <p className="import-info">This PDF is password-protected. Enter the password to continue.</p>
            <p className="import-attempt-warn">{passwordAttempts > 0 ? `Incorrect password. ${3 - passwordAttempts} attempt(s) remaining.` : ''}</p>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handlePasswordSubmit() }}
              placeholder="PDF password…" autoFocus aria-label="PDF password"
              className="import-password-input"
            />
            <div className="import-actions">
              <button onClick={onClose} className="btn-cancel">Cancel</button>
              <button onClick={handlePasswordSubmit} className="btn-primary-action">Unlock & Import</button>
            </div>
          </div>
        )}

        {/* ── Progress ── */}
        {step === 'progress' && progress && (
          <div className="import-body">
            <div className="import-state-label">{progress.message}</div>
            <div className="import-progress-wrap" role="progressbar" aria-valuenow={progress.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="import-progress-bar" style={{ width: `${progress.pct}%` }} />
            </div>
            <div className="import-progress-stats">
              {progress.total > 0 ? `${progress.done} / ${progress.total} pages` : 'Analyzing…'} · {progress.pct}%
            </div>
            <button onClick={handleCancel} className="btn-cancel-import">Cancel import</button>
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && result && (
          <div className="import-body">
            <div className="import-success">
              <span className="import-success-icon">✓</span>
              <div>
                <strong>Import complete</strong>
                <p>Document imported from PDF using reconstruction. Verify layout before sharing.</p>
              </div>
            </div>

            {result.anomalies.length > 0 && (
              <div className="import-anomaly-count">
                {result.anomalies.length} warning{result.anomalies.length > 1 ? 's' : ''} detected.
                <button onClick={() => setShowReport(v => !v)} className="btn-link">
                  {showReport ? 'Hide' : 'View'} import report
                </button>
              </div>
            )}

            {showReport && (
              <div className="import-report">
                {result.anomalies.map((a, i) => (
                  <div key={i} className={`import-anomaly import-anomaly-${a.severity}`}>
                    <span className="import-anomaly-badge">{a.severity.toUpperCase()}</span>
                    <span>{a.message}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="import-actions">
              <button onClick={onClose} className="btn-cancel">Close</button>
              <button onClick={() => onComplete(result.html, result.jobId)} className="btn-primary-action">
                Open in Editor
              </button>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {step === 'error' && (
          <div className="import-body">
            <div className="import-error">
              <span className="import-error-icon">✗</span>
              <div>
                <strong>Import failed</strong>
                <p>{errorMsg}</p>
              </div>
            </div>
            <div className="import-actions">
              <button onClick={() => setStep('options')} className="btn-cancel">Back</button>
              <button onClick={onClose} className="btn-primary-action">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
