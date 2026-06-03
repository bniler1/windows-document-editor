import { useState } from 'react'
import type { OutputFormat } from '../../types'

interface Props {
  sessionId: string
  selectedPages: number[]
  sourcePdfPath: string
  onClose: () => void
  onExtracted: (message: string) => void
}

export default function ExtractionModal({
  sessionId,
  selectedPages,
  sourcePdfPath,
  onClose,
  onExtracted,
}: Props) {
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('pdf')
  const [includeRotations, setIncludeRotations] = useState(true)
  const [preserveOrder, setPreserveOrder] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectionSpec = selectedPages.sort((a, b) => a - b).join(',')

  const handleExtract = async () => {
    setIsRunning(true)
    setError(null)
    try {
      const job = await window.pageApi.extract({
        sessionId,
        selectionSpec,
        outputFormat,
        destinationPath: '',
        sourcePdfPath,
        includeRotations,
        preserveOrder,
      })
      if (job) {
        onExtracted(`Extracted ${selectedPages.length} page${selectedPages.length > 1 ? 's' : ''} to ${job.resultFilePath}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="extract-title">
      <div className="modal-content">
        <h2 id="extract-title">Extract Pages</h2>

        <div className="modal-field">
          <label>Selected pages</label>
          <p className="modal-value">{selectionSpec}</p>
        </div>

        <div className="modal-field">
          <label htmlFor="extract-format">Output format</label>
          <select
            id="extract-format"
            value={outputFormat}
            onChange={(e) => setOutputFormat(e.target.value as OutputFormat)}
          >
            <option value="pdf">PDF</option>
            <option value="docx">Word Document (DOCX)</option>
          </select>
        </div>

        <div className="modal-field">
          <label>
            <input
              type="checkbox"
              checked={includeRotations}
              onChange={(e) => setIncludeRotations(e.target.checked)}
            />
            {' '}Apply page rotations to output
          </label>
        </div>

        <div className="modal-field">
          <label>
            <input
              type="checkbox"
              checked={preserveOrder}
              onChange={(e) => setPreserveOrder(e.target.checked)}
            />
            {' '}Preserve page order
          </label>
        </div>

        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button onClick={onClose} disabled={isRunning}>
            Cancel
          </button>
          <button
            onClick={handleExtract}
            disabled={isRunning || selectedPages.length === 0}
            className="btn-primary"
          >
            {isRunning ? 'Extracting…' : 'Extract'}
          </button>
        </div>
      </div>
    </div>
  )
}
