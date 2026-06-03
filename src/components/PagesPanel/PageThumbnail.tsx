import type { SessionPage } from '../../types'

interface Props {
  page: SessionPage
  isSelected: boolean
  isDragOver: boolean
  onSelect: (pageNum: number, e: React.MouseEvent) => void
  onDragStart: (pageNum: number) => void
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
}

export default function PageThumbnail({
  page,
  isSelected,
  isDragOver,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
  const label = `Page ${page.originalPageNumber}${isSelected ? ', selected' : ''}`

  return (
    <div
      className={[
        'page-thumbnail',
        isSelected ? 'selected' : '',
        isDragOver ? 'drag-over' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="listitem"
      aria-label={label}
      tabIndex={0}
      draggable
      onClick={(e) => onSelect(page.originalPageNumber, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(page.originalPageNumber, e as unknown as React.MouseEvent)
        }
      }}
      onDragStart={() => onDragStart(page.originalPageNumber)}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
    >
      <div
        className="page-thumbnail-canvas"
        style={{ transform: `rotate(${page.rotationDeg}deg)` }}
        aria-hidden="true"
      >
        <div className="page-thumbnail-placeholder">
          <span>{page.originalPageNumber}</span>
        </div>
      </div>
      <div className="page-thumbnail-label">
        <span>Page {page.originalPageNumber}</span>
        {page.rotationDeg !== 0 && (
          <span className="page-rotation-badge" aria-label={`Rotated ${page.rotationDeg}°`}>
            {page.rotationDeg}°
          </span>
        )}
      </div>
    </div>
  )
}
