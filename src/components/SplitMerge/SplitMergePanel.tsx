import { useState } from 'react'
import './SplitMerge.css'

type Mode = 'split' | 'merge'

interface MergeFile { path: string; range: string }

export default function SplitMergePanel() {
  const [mode, setMode] = useState<Mode>('split')
  // Split state
  const [splitSource, setSplitSource] = useState<string | null>(null)
  const [splitRanges, setSplitRanges] = useState<string[]>(['1-5', '6-10'])
  const [splitTemplate, setSplitTemplate] = useState('{basename}_part{index}')
  // Merge state
  const [mergeFiles, setMergeFiles] = useState<MergeFile[]>([])
  // Shared
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pickSplitSource = async () => {
    const [p] = await window.pdfApi.pickFiles()
    if (p) setSplitSource(p)
  }

  const addMergeFiles = async () => {
    const paths = await window.pdfApi.pickFiles()
    setMergeFiles((prev) => [
      ...prev,
      ...paths.map((p: string) => ({ path: p, range: 'all' })),
    ])
  }

  const removeMergeFile = (idx: number) =>
    setMergeFiles((prev) => prev.filter((_, i) => i !== idx))

  const moveMergeFile = (idx: number, dir: 1 | -1) => {
    setMergeFiles((prev) => {
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const addRange = () => setSplitRanges((prev) => [...prev, ''])
  const updateRange = (i: number, v: string) =>
    setSplitRanges((prev) => prev.map((r, idx) => (idx === i ? v : r)))
  const removeRange = (i: number) =>
    setSplitRanges((prev) => prev.filter((_, idx) => idx !== i))

  const runSplit = async () => {
    if (!splitSource) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await window.pdfApi.split({
        sourcePath: splitSource,
        outputDir: '',
        ranges: splitRanges.filter(Boolean),
        nameTemplate: splitTemplate,
        overwrite: true,
      })
      if (res) {
        setResult(`Split complete: ${res.outputs.length} file(s) created. ${res.errors.length > 0 ? `${res.errors.length} error(s).` : ''}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Split failed')
    } finally {
      setRunning(false)
    }
  }

  const runMerge = async () => {
    if (mergeFiles.length < 2) { setError('Add at least 2 files to merge'); return }
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await window.pdfApi.merge({
        inputs: mergeFiles.map((f) => ({ path: f.path, pageRange: f.range || 'all' })),
        outputPath: '',
        overwrite: true,
      })
      if (res) {
        setResult(`Merged: ${res.totalPages} pages from ${res.sourceFiles} file(s) → ${res.outputPath}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Merge failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="tool-panel" role="region" aria-label="PDF Split & Merge">
      <div className="tool-tabs" role="tablist">
        <button role="tab" aria-selected={mode === 'split'} onClick={() => setMode('split')} className={mode === 'split' ? 'active' : ''}>Split</button>
        <button role="tab" aria-selected={mode === 'merge'} onClick={() => setMode('merge')} className={mode === 'merge' ? 'active' : ''}>Merge</button>
      </div>

      {mode === 'split' && (
        <div className="tool-section">
          <div className="field-row">
            <label>Source PDF</label>
            <div className="field-value-row">
              <span className="path-display">{splitSource ?? 'None selected'}</span>
              <button onClick={pickSplitSource} aria-label="Choose source PDF">Choose…</button>
            </div>
          </div>

          <div className="field-row">
            <label>Output naming template</label>
            <input
              value={splitTemplate}
              onChange={(e) => setSplitTemplate(e.target.value)}
              placeholder="{basename}_part{index}"
              aria-label="Output naming template"
            />
            <span className="hint">Use {'{basename}'} and {'{index}'}</span>
          </div>

          <div className="field-row">
            <label>Page ranges (one output per range)</label>
            {splitRanges.map((r, i) => (
              <div key={i} className="range-row">
                <input
                  value={r}
                  onChange={(e) => updateRange(i, e.target.value)}
                  placeholder="e.g. 1-5 or odd"
                  aria-label={`Range ${i + 1}`}
                />
                <button onClick={() => removeRange(i)} aria-label={`Remove range ${i + 1}`} className="btn-icon">×</button>
              </div>
            ))}
            <button onClick={addRange} className="btn-sm">+ Add range</button>
          </div>

          <button
            onClick={runSplit}
            disabled={running || !splitSource}
            className="btn-primary-action"
            aria-busy={running}
          >
            {running ? 'Splitting…' : 'Split PDF'}
          </button>
        </div>
      )}

      {mode === 'merge' && (
        <div className="tool-section">
          <div className="field-row">
            <label>Files to merge (in order)</label>
            {mergeFiles.length === 0 && <p className="empty-hint">No files added yet</p>}
            {mergeFiles.map((f, i) => (
              <div key={i} className="merge-file-row">
                <div className="merge-file-info">
                  <span className="merge-file-name" title={f.path}>{f.path.split(/[\\/]/).pop()}</span>
                  <input
                    value={f.range}
                    onChange={(e) => setMergeFiles((prev) => prev.map((x, idx) => idx === i ? { ...x, range: e.target.value } : x))}
                    placeholder="all"
                    aria-label={`Page range for file ${i + 1}`}
                    className="range-inline"
                  />
                </div>
                <div className="merge-file-actions">
                  <button onClick={() => moveMergeFile(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button onClick={() => moveMergeFile(i, 1)} disabled={i === mergeFiles.length - 1} aria-label="Move down">↓</button>
                  <button onClick={() => removeMergeFile(i)} aria-label="Remove file" className="btn-danger-sm">×</button>
                </div>
              </div>
            ))}
            <button onClick={addMergeFiles} className="btn-sm">+ Add files…</button>
          </div>

          <button
            onClick={runMerge}
            disabled={running || mergeFiles.length < 2}
            className="btn-primary-action"
            aria-busy={running}
          >
            {running ? 'Merging…' : 'Merge PDFs'}
          </button>
        </div>
      )}

      {result && <p className="result-msg" role="status" aria-live="polite">✓ {result}</p>}
      {error && <p className="error-msg" role="alert">✗ {error}</p>}
    </div>
  )
}
