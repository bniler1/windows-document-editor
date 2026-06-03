import { useState, useCallback } from 'react'
import EditorPanel from './components/Editor/EditorPanel'
import PagesPanel from './components/PagesPanel/PagesPanel'
import OcrBanner from './components/OcrPanel/OcrBanner'
import SplitMergePanel from './components/SplitMerge/SplitMergePanel'
import CompressPanel from './components/Compress/CompressPanel'
import AnnotationToolbar from './components/Annotations/AnnotationToolbar'
import PdfViewer from './components/PdfViewer/PdfViewer'
import { usePageSession } from './hooks/usePageSession'
import './App.css'

type View = 'editor' | 'pdf-view' | 'split-merge' | 'compress' | 'annotations'

const NAV_ITEMS: { view: View; label: string; icon: string }[] = [
  { view: 'editor',     label: 'Editor',       icon: '✏️' },
  { view: 'pdf-view',   label: 'PDF View',     icon: '📄' },
  { view: 'split-merge',label: 'Split/Merge',  icon: '✂️' },
  { view: 'compress',   label: 'Compress',     icon: '📦' },
  { view: 'annotations',label: 'Annotate',     icon: '🖊' },
]

function makeDocId(p: string) {
  return 'doc-' + p.replace(/[^a-z0-9]/gi, '-').slice(-40)
}

export default function App() {
  const [pdfPath, setPdfPath] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [view, setView] = useState<View>('editor')
  const [showPages, setShowPages] = useState(false)
  const [activePage, setActivePage] = useState(1)
  const [statusMsg, setStatusMsg] = useState('')
  const [wordCount, setWordCount] = useState(0)

  const documentId = pdfPath ? makeDocId(pdfPath) : 'doc-new'

  const { session, pages, loading: sessionLoading, refreshPages } = usePageSession(
    showPages && pdfPath ? documentId : null,
    pageCount,
    pdfPath ?? 'empty',
  )

  const handleOpenFile = useCallback(async () => {
    const path = await window.fileApi.openDialog()
    if (!path) return
    setPdfPath(path)
    setActivePage(1)
    const name = path.split(/[\\/]/).pop() ?? path
    setStatusMsg(`Opened: ${name}`)
    // Auto-switch: PDFs go to editor (text import) or pdf-view
    if (path.toLowerCase().endsWith('.pdf')) {
      setView('editor')   // will import text into TipTap
    }
  }, [])

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="app-header">
        <span className="app-title">Document Editor</span>
        <div className="app-header-actions">
          <button onClick={handleOpenFile} aria-label="Open file">Open File…</button>
          {view === 'pdf-view' && pdfPath && (
            <button onClick={() => setShowPages((v) => !v)}>
              {showPages ? 'Hide Pages' : 'Show Pages'}
            </button>
          )}
        </div>
        <div className="app-header-center">
          {wordCount > 0 && view === 'editor' && (
            <span className="app-word-count">{wordCount} words</span>
          )}
        </div>
        {statusMsg && <span className="app-status" role="status" aria-live="polite">{statusMsg}</span>}
      </header>

      <div className="app-body">
        <nav className="app-nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? 'active' : ''}`}
              onClick={() => setView(item.view)}
              aria-current={view === item.view ? 'page' : undefined}
              title={item.label}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="app-content">
          {/* OCR banner — editor + pdf-view when PDF is loaded */}
          {(view === 'editor' || view === 'pdf-view') && pdfPath && (
            <OcrBanner
              documentId={documentId}
              pdfPath={pdfPath}
              totalPages={pageCount}
              currentPage={activePage}
              onTextMerged={(count) => setStatusMsg(`Imported ${count} words from OCR`)}
            />
          )}

          {/* Annotation toolbar */}
          {view === 'annotations' && pdfPath && (
            <AnnotationToolbar documentId={documentId} pdfPath={pdfPath} activePage={activePage} />
          )}

          <div className="app-body-inner">
            {/* Pages panel — only in pdf-view */}
            {view === 'pdf-view' && showPages && pdfPath && session && !sessionLoading && (
              <aside className="app-sidebar" aria-label="Pages panel" role="complementary">
                <PagesPanel
                  sessionId={session.id}
                  pages={pages}
                  sourcePdfPath={pdfPath}
                  onPagesChanged={refreshPages}
                />
              </aside>
            )}

            <main className="app-main" role="main" id="main-content">
              {/* ── Editor (TipTap) ── */}
              {view === 'editor' && (
                <EditorPanel
                  key={pdfPath ?? 'new'}
                  pdfPath={pdfPath}
                  documentId={documentId}
                  onWordCount={setWordCount}
                />
              )}

              {/* ── PDF viewer (read-only) ── */}
              {view === 'pdf-view' && !pdfPath && (
                <div className="app-welcome">
                  <h1>PDF Viewer</h1>
                  <p>Open a PDF to view its pages.</p>
                  <button className="btn-primary-lg" onClick={handleOpenFile}>Open PDF…</button>
                </div>
              )}
              {view === 'pdf-view' && pdfPath && (
                <PdfViewer
                  key={pdfPath}
                  pdfPath={pdfPath}
                  documentId={documentId}
                  currentPage={activePage}
                  onPageChange={setActivePage}
                  onPageCount={setPageCount}
                />
              )}

              {/* ── Tools ── */}
              {view === 'split-merge' && <SplitMergePanel />}
              {view === 'compress' && <CompressPanel />}

              {view === 'annotations' && !pdfPath && (
                <div className="app-welcome">
                  <p>Open a PDF to annotate.</p>
                  <button className="btn-primary-lg" onClick={handleOpenFile}>Open PDF…</button>
                </div>
              )}
              {view === 'annotations' && pdfPath && (
                <PdfViewer
                  key={`ann-${pdfPath}`}
                  pdfPath={pdfPath}
                  documentId={documentId}
                  currentPage={activePage}
                  onPageChange={setActivePage}
                  onPageCount={setPageCount}
                />
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  )
}
