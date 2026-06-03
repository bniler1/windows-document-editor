import { useEffect, useRef, useState } from 'react'

interface Props {
  fileBase64: string
  onHtmlExtracted?: (html: string) => void
}

export default function DocxViewer({ fileBase64, onHtmlExtracted }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!containerRef.current || !fileBase64) return
    setLoading(true)
    setError(null)

    const render = async () => {
      try {
        const { renderAsync } = await import('docx-preview')

        // Convert base64 to ArrayBuffer
        const binary = atob(fileBase64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const buffer = bytes.buffer

        const styleContainer = document.createElement('div')
        await renderAsync(buffer, containerRef.current!, styleContainer, {
          className: 'docx-preview-content',
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
          renderChanges: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
        })

        // Inject styles from docx-preview
        document.head.appendChild(styleContainer)

        // Extract rendered HTML for editing mode
        onHtmlExtracted?.(containerRef.current!.innerHTML)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to render document')
        setLoading(false)
      }
    }

    render()
  }, [fileBase64])

  if (loading) return (
    <div className="docx-loading" role="status">
      <div className="pdf-spinner" aria-hidden="true" />
      Rendering document…
    </div>
  )

  if (error) return (
    <div className="pdf-error" role="alert">
      <strong>Could not render document</strong>
      <p>{error}</p>
    </div>
  )

  return (
    <div
      ref={containerRef}
      className="docx-viewer-container"
      aria-label="Document preview"
    />
  )
}
