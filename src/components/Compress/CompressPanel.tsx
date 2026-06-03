import { useState, useEffect } from 'react'
import './Compress.css'

type Profile = 'HighQuality' | 'Balanced' | 'Smallest' | 'Custom'

interface FileStats { pages: number; fileSizeBytes: number; estimatedImageCount: number }
interface CompressResult {
  inputSizeBytes: number; outputSizeBytes: number
  savedBytes: number; savedPercent: number; pages: number
}

const PROFILE_DESC: Record<Profile, string> = {
  HighQuality: '300 DPI images · JPEG 85% · preserve tags',
  Balanced: '200 DPI images · JPEG 75% · deduplicate resources',
  Smallest: '150 DPI images · JPEG 60% · remove metadata & thumbnails',
  Custom: 'Configure options manually',
}

export default function CompressPanel() {
  const [sourceFile, setSourceFile] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile>('Balanced')
  const [removeMetadata, setRemoveMetadata] = useState(false)
  const [removeThumbnails, setRemoveThumbnails] = useState(false)
  const [stats, setStats] = useState<FileStats | null>(null)
  const [result, setResult] = useState<CompressResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickFile = async () => {
    const [p] = await window.pdfApi.pickFiles()
    if (!p) return
    setSourceFile(p)
    setResult(null)
    setError(null)
    try {
      const s = await window.pdfApi.fileStats(p)
      setStats(s)
    } catch { setStats(null) }
  }

  const run = async () => {
    if (!sourceFile) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await window.pdfApi.compress(sourceFile, {
        profile,
        structure: {
          removeMetadataXMP: profile === 'Smallest' || removeMetadata,
          removeThumbnails: profile === 'Smallest' || profile === 'Balanced' || removeThumbnails,
          removeUnusedObjects: true,
          subsetFonts: true,
        },
      })
      if (res) setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compression failed')
    } finally {
      setRunning(false)
    }
  }

  const fmt = (bytes: number) =>
    bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`

  return (
    <div className="tool-panel" role="region" aria-label="PDF Compress & Optimize">
      <h2 className="tool-title">Compress & Optimize PDF</h2>

      <div className="field-row">
        <label>Source PDF</label>
        <div className="field-value-row">
          <span className="path-display">{sourceFile ? sourceFile.split(/[\\/]/).pop() : 'None selected'}</span>
          <button onClick={pickFile} aria-label="Choose PDF to compress">Choose…</button>
        </div>
        {stats && (
          <p className="file-meta">
            {stats.pages} pages · {fmt(stats.fileSizeBytes)} · ~{stats.estimatedImageCount} images
          </p>
        )}
      </div>

      <div className="field-row">
        <label>Quality preset</label>
        <div className="profile-grid" role="radiogroup" aria-label="Compression profile">
          {(['HighQuality', 'Balanced', 'Smallest', 'Custom'] as Profile[]).map((p) => (
            <label key={p} className={`profile-option ${profile === p ? 'selected' : ''}`}>
              <input type="radio" name="profile" value={p} checked={profile === p} onChange={() => setProfile(p)} />
              <strong>{p}</strong>
              <span>{PROFILE_DESC[p]}</span>
            </label>
          ))}
        </div>
      </div>

      {profile === 'Custom' && (
        <div className="field-row options-custom">
          <label>
            <input type="checkbox" checked={removeMetadata} onChange={(e) => setRemoveMetadata(e.target.checked)} />
            {' '}Remove XMP metadata
          </label>
          <label>
            <input type="checkbox" checked={removeThumbnails} onChange={(e) => setRemoveThumbnails(e.target.checked)} />
            {' '}Remove embedded thumbnails
          </label>
        </div>
      )}

      <button
        onClick={run}
        disabled={running || !sourceFile}
        className="btn-primary-action"
        aria-busy={running}
      >
        {running ? 'Compressing…' : 'Compress PDF'}
      </button>

      {result && (
        <div className="compress-result" role="status" aria-live="polite">
          <div className="compress-result-row">
            <span>Before</span><strong>{fmt(result.inputSizeBytes)}</strong>
          </div>
          <div className="compress-result-row">
            <span>After</span><strong>{fmt(result.outputSizeBytes)}</strong>
          </div>
          <div className="compress-result-row saved">
            <span>Saved</span>
            <strong>{fmt(Math.max(0, result.savedBytes))} ({Math.max(0, result.savedPercent)}%)</strong>
          </div>
        </div>
      )}

      {error && <p className="error-msg" role="alert">✗ {error}</p>}
    </div>
  )
}
