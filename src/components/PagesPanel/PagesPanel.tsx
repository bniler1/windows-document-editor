import { useState, useCallback, useRef } from 'react'
import type { SessionPage, RotationDeg } from '../../types'
import PageThumbnail from './PageThumbnail'
import ExtractionModal from './ExtractionModal'
import './PagesPanel.css'

interface Props {
  sessionId: string
  pages: SessionPage[]
  sourcePdfPath: string
  onPagesChanged: () => void
}

export default function PagesPanel({ sessionId, pages, sourcePdfPath, onPagesChanged }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [anchor, setAnchor] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [showExtractModal, setShowExtractModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const draggedPages = useRef<number[]>([])

  const activePagesOrdered = pages
    .filter((p) => !p.isDeleted)
    .sort((a, b) => a.currentOrderIndex - b.currentOrderIndex)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const handleSelect = useCallback(
    (pageNum: number, e: React.MouseEvent) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (e.shiftKey && anchor !== null) {
          const anchorIdx = activePagesOrdered.findIndex(
            (p) => p.originalPageNumber === anchor,
          )
          const targetIdx = activePagesOrdered.findIndex(
            (p) => p.originalPageNumber === pageNum,
          )
          const [lo, hi] = [Math.min(anchorIdx, targetIdx), Math.max(anchorIdx, targetIdx)]
          for (let i = lo; i <= hi; i++) {
            next.add(activePagesOrdered[i].originalPageNumber)
          }
        } else if (e.ctrlKey || e.metaKey) {
          if (next.has(pageNum)) next.delete(pageNum)
          else next.add(pageNum)
        } else {
          next.clear()
          next.add(pageNum)
        }
        return next
      })
      setAnchor(pageNum)
    },
    [anchor, activePagesOrdered],
  )

  const handleSelectAll = useCallback(() => {
    setSelected(new Set(activePagesOrdered.map((p) => p.originalPageNumber)))
  }, [activePagesOrdered])

  const handleRotate = useCallback(
    async (dir: 'cw' | 'ccw') => {
      if (selected.size === 0) return
      const pages = Array.from(selected)
      const first = activePagesOrdered.find((p) => p.originalPageNumber === pages[0])
      if (!first) return

      const step = dir === 'cw' ? 90 : -90
      const newRot = (((first.rotationDeg + step) % 360) + 360) % 360 as RotationDeg

      await window.pageApi.rotate({
        sessionId,
        pages,
        rotationDeg: newRot,
      })
      onPagesChanged()
    },
    [selected, sessionId, activePagesOrdered, onPagesChanged],
  )

  const handleDelete = useCallback(async () => {
    if (selected.size === 0) return
    const confirmed = window.confirm(
      `Delete ${selected.size} page${selected.size > 1 ? 's' : ''}? This can be undone.`,
    )
    if (!confirmed) return

    await window.pageApi.delete({ sessionId, pages: Array.from(selected) })
    setSelected(new Set())
    onPagesChanged()
  }, [selected, sessionId, onPagesChanged])

  const handleUndo = useCallback(async () => {
    await window.pageApi.undo({ sessionId })
    onPagesChanged()
  }, [sessionId, onPagesChanged])

  // ── Drag & drop ─────────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (pageNum: number) => {
      if (!selected.has(pageNum)) {
        setSelected(new Set([pageNum]))
      }
      draggedPages.current = selected.has(pageNum)
        ? Array.from(selected)
        : [pageNum]
    },
    [selected],
  )

  const handleDrop = useCallback(
    async (insertAfterPage: number) => {
      if (draggedPages.current.length === 0) return
      if (
        draggedPages.current.length === 1 &&
        draggedPages.current[0] === insertAfterPage
      ) {
        showToast('No change')
        setDragOver(null)
        return
      }

      await window.pageApi.reorder({
        sessionId,
        sourcePages: draggedPages.current,
        insertAfterPage,
      })
      draggedPages.current = []
      setDragOver(null)
      onPagesChanged()
    },
    [sessionId, onPagesChanged],
  )

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        handleSelectAll()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete()
      } else if (e.key === ']' && e.ctrlKey) {
        handleRotate('cw')
      } else if (e.key === '[' && e.ctrlKey) {
        handleRotate('ccw')
      } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        handleUndo()
      }
    },
    [handleSelectAll, handleDelete, handleRotate, handleUndo],
  )

  return (
    <div className="pages-panel" tabIndex={0} onKeyDown={handleKeyDown} aria-label="Pages panel">
      <div className="pages-toolbar" role="toolbar" aria-label="Page actions">
        <button
          onClick={() => handleRotate('ccw')}
          disabled={selected.size === 0}
          title="Rotate Counter-clockwise (Ctrl+[)"
          aria-label="Rotate counter-clockwise"
        >
          ↺
        </button>
        <button
          onClick={() => handleRotate('cw')}
          disabled={selected.size === 0}
          title="Rotate Clockwise (Ctrl+])"
          aria-label="Rotate clockwise"
        >
          ↻
        </button>
        <button
          onClick={() => setShowExtractModal(true)}
          disabled={selected.size === 0}
          title="Extract pages"
          aria-label="Extract selected pages"
        >
          Extract…
        </button>
        <button
          onClick={handleDelete}
          disabled={selected.size === 0}
          title="Delete selected pages"
          aria-label="Delete selected pages"
          className="btn-danger"
        >
          Delete
        </button>
        <button onClick={handleUndo} title="Undo (Ctrl+Z)" aria-label="Undo last action">
          Undo
        </button>
        <span className="pages-selection-info" aria-live="polite">
          {selected.size > 0
            ? `${selected.size} page${selected.size > 1 ? 's' : ''} selected`
            : `${activePagesOrdered.length} pages`}
        </span>
      </div>

      <div
        className="pages-thumbnail-grid"
        role="list"
        aria-label="Document pages"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => handleDrop(0)}
      >
        {activePagesOrdered.map((page) => (
          <PageThumbnail
            key={page.id}
            page={page}
            isSelected={selected.has(page.originalPageNumber)}
            isDragOver={dragOver === page.originalPageNumber}
            onSelect={handleSelect}
            onDragStart={handleDragStart}
            onDragOver={() => setDragOver(page.originalPageNumber)}
            onDragLeave={() => setDragOver(null)}
            onDrop={() => handleDrop(page.originalPageNumber)}
          />
        ))}
      </div>

      {showExtractModal && (
        <ExtractionModal
          sessionId={sessionId}
          selectedPages={Array.from(selected)}
          sourcePdfPath={sourcePdfPath}
          onClose={() => setShowExtractModal(false)}
          onExtracted={(msg) => {
            setShowExtractModal(false)
            showToast(msg)
          }}
        />
      )}

      {toast && (
        <div className="pages-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
