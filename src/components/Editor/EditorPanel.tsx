import { useEffect, useState, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { Underline } from '@tiptap/extension-underline'
import { TextStyle } from '@tiptap/extension-text-style'
import { FontFamily } from '@tiptap/extension-font-family'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlign } from '@tiptap/extension-text-align'
import { Image } from '@tiptap/extension-image'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { Typography } from '@tiptap/extension-typography'
import { Placeholder } from '@tiptap/extension-placeholder'
import { CharacterCount } from '@tiptap/extension-character-count'
import { Link } from '@tiptap/extension-link'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Extension } from '@tiptap/core'
import DocxViewer from './DocxViewer'
import FormattingToolbar from './FormattingToolbar'
import FindReplaceBar from './FindReplaceBar'
import { importPdfAsHtml } from '../../lib/pdfImport'
import './Editor.css'

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => el.style.fontSize || null,
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }]
  },
})

type DocMode = 'empty' | 'docx-view' | 'docx-edit' | 'pdf-edit'

interface Props {
  pdfPath: string | null
  documentId: string
  onWordCount?: (n: number) => void
}

export default function EditorPanel({ pdfPath, documentId, onWordCount }: Props) {
  const [mode, setMode] = useState<DocMode>('empty')
  const [docxBase64, setDocxBase64] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle'|'saving'|'saved'>('idle')
  const [statusMsg, setStatusMsg] = useState('')
  const docxContainerRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1,2,3,4,5,6] } }),
      Underline, TextStyle, FontSize, FontFamily,
      Color, Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading','paragraph'] }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: true }),
      TableRow, TableCell, TableHeader,
      Typography, CharacterCount,
      Link.configure({ openOnClick: false }),
      Subscript, Superscript,
      Placeholder.configure({ placeholder: 'Start typing, or open a document to begin…' }),
    ],
    content: '<p></p>',
    onUpdate: ({ editor: ed }) => onWordCount?.(ed.storage.characterCount.words()),
    editorProps: { attributes: { class: 'editor-content-area', spellcheck: 'true' } },
  })

  // ── Open file ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfPath) { setMode('empty'); return }
    const lower = pdfPath.toLowerCase()

    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
      // DOCX: load for docx-preview (high-fidelity view)
      window.fileApi.read(pdfPath)
        .then(({ base64 }: { base64: string }) => {
          setDocxBase64(base64)
          setMode('docx-view')
          setStatusMsg(`Opened: ${pdfPath.split(/[\\/]/).pop()}`)
        })
        .catch((e: unknown) => setStatusMsg('Error opening file: ' + String(e)))
    } else if (lower.endsWith('.pdf')) {
      // PDF: extract text preserving structure
      setStatusMsg('Importing PDF text…')
      importPdfAsHtml(pdfPath)
        .then(html => {
          editor?.commands.setContent(html)
          setMode('pdf-edit')
          setStatusMsg(`PDF imported — ${editor?.storage.characterCount.words() ?? 0} words`)
        })
        .catch(() => {
          editor?.commands.setContent('<p>Could not import PDF text. Run OCR first for scanned files.</p>')
          setMode('pdf-edit')
        })
    } else if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      window.fileApi.read(pdfPath).then(({ base64 }: { base64: string }) => {
        const text = decodeURIComponent(escape(atob(base64)))
        const html = text.split('\n').map(l => `<p>${l || '&nbsp;'}</p>`).join('')
        editor?.commands.setContent(html)
        setMode('pdf-edit')
        setStatusMsg(`Opened: ${pdfPath.split(/[\\/]/).pop()}`)
      })
    }
  }, [pdfPath, editor])

  // Restore autosave for blank docs
  useEffect(() => {
    if (!editor || pdfPath) return
    const saved = localStorage.getItem(`doc-${documentId}`)
    if (saved) { editor.commands.setContent(saved); setMode('pdf-edit') }
  }, [editor, documentId, pdfPath])

  // ── Switch docx-view → docx-edit ──────────────────────────────────────────
  const switchToEdit = useCallback((renderedHtml?: string) => {
    if (!editor) return
    // Load rendered HTML from docx-preview into TipTap for editing
    const html = renderedHtml ?? docxContainerRef.current?.innerHTML ?? ''
    editor.commands.setContent(html || '<p></p>')
    setMode('docx-edit')
    setStatusMsg('Editing mode — all changes saved locally')
  }, [editor])

  // ── Autosave ───────────────────────────────────────────────────────────────
  const doSave = useCallback(() => {
    if (!editor) return
    localStorage.setItem(`doc-${documentId}`, editor.getHTML())
  }, [editor, documentId])

  useEffect(() => {
    const t = setInterval(doSave, 30_000)
    return () => clearInterval(t)
  }, [doSave])

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const exportPdf = useCallback(async () => {
    if (!editor) return
    setSaveStatus('saving')
    try {
      const { PDFDocument: PdfDoc, StandardFonts: SF, rgb } = await import('pdf-lib')
      const doc = await PdfDoc.create()
      const font = await doc.embedFont(SF.Helvetica)
      const boldFont = await doc.embedFont(SF.HelveticaBold)
      const margin = 60, pageW = 595, pageH = 842, lineH = 18

      const div = document.createElement('div')
      div.innerHTML = editor.getHTML()
      let page = doc.addPage([pageW, pageH]), y = pageH - margin
      const newPage = () => { page = doc.addPage([pageW, pageH]); y = pageH - margin }
      const ensureSpace = (n: number) => { if (y < margin + n) newPage() }

      for (const el of Array.from(div.children)) {
        const tag = el.tagName.toLowerCase()
        const text = el.textContent?.trim() ?? ''
        if (!text && tag !== 'hr') continue
        if (tag === 'hr') {
          ensureSpace(20)
          page.drawLine({ start:{x:margin,y}, end:{x:pageW-margin,y}, thickness:0.5, color:rgb(0.7,0.7,0.7) })
          y -= 20; continue
        }
        const isH = /^h[1-6]$/.test(tag)
        const fs = isH ? Math.max(10, 22 - parseInt(tag[1]) * 2) : 11
        const f = isH ? boldFont : font
        const words = text.split(/\s+/)
        let line = ''
        for (const w of words) {
          const test = line ? `${line} ${w}` : w
          if (f.widthOfTextAtSize(test, fs) > pageW - margin * 2 && line) {
            ensureSpace(fs + 8)
            page.drawText(line, { x:margin, y, size:fs, font:f, color:rgb(0,0,0) })
            y -= lineH; line = w
          } else line = test
        }
        if (line) {
          ensureSpace(fs + 8)
          page.drawText(line, { x:margin, y, size:fs, font:f, color:rgb(0,0,0) })
          y -= lineH + (isH ? 4 : 2)
        }
      }

      const bytes = await doc.save()
      const b64 = btoa(String.fromCharCode(...bytes))
      const savePath = await window.fileApi.saveDialog('document.pdf')
      if (savePath) { await window.fileApi.write(savePath, b64); setSaveStatus('saved') }
      else setSaveStatus('idle')
      setTimeout(() => setSaveStatus('idle'), 3000)
    } catch { setSaveStatus('idle') }
  }, [editor])

  const exportTxt = useCallback(async () => {
    if (!editor) return
    const b64 = btoa(unescape(encodeURIComponent(editor.getText('\n'))))
    const p = await window.fileApi.saveDialog('document.txt')
    if (p) await window.fileApi.write(p, b64)
  }, [editor])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 's') { e.preventDefault(); doSave(); setSaveStatus('saved'); setTimeout(()=>setSaveStatus('idle'),2000) }
      if (mod && e.key === 'k') {
        e.preventDefault()
        const url = prompt('Enter URL:')
        if (url) editor?.chain().focus().setLink({ href: url }).run()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [doSave, editor])

  if (!editor) return null

  const inEditMode = mode === 'docx-edit' || mode === 'pdf-edit' || mode === 'empty'
  const wc = editor.storage.characterCount.words()

  return (
    <div className="editor-shell">
      {/* Toolbar — only in edit mode */}
      {inEditMode && (
        <FormattingToolbar
          editor={editor}
          onFindReplace={() => {/* handled by FindReplaceBar below */}}
        />
      )}

      {/* ALWAYS-VISIBLE Find & Replace bar */}
      <FindReplaceBar
        editor={inEditMode ? editor : null}
        container={mode === 'docx-view' ? docxContainerRef.current : null}
      />

      {/* Action bar */}
      <div className="editor-action-bar">
        <div className="editor-file-actions">
          {mode === 'docx-view' && (
            <button className="editor-action-btn btn-switch-edit"
              onClick={() => switchToEdit()}>
              ✏️ Switch to Edit Mode
            </button>
          )}
          {inEditMode && (
            <>
              <button className="editor-action-btn" onClick={exportPdf} disabled={saveStatus==='saving'}>
                {saveStatus==='saving' ? 'Saving…' : saveStatus==='saved' ? '✓ Saved' : '⬇ Export PDF'}
              </button>
              <button className="editor-action-btn" onClick={exportTxt}>⬇ TXT</button>
              <button className="editor-action-btn"
                onClick={() => { doSave(); setSaveStatus('saved'); setTimeout(()=>setSaveStatus('idle'),2000) }}>
                💾 {saveStatus==='saved' ? 'Saved!' : 'Save (Ctrl+S)'}
              </button>
            </>
          )}
        </div>
        <div className="editor-status-bar">
          {statusMsg && <span className="status-done">{statusMsg}</span>}
          {inEditMode && (
            <span className="editor-word-count">{wc} word{wc!==1?'s':''}</span>
          )}
          {mode === 'docx-view' && (
            <span className="status-view-hint">📖 View mode — click "Switch to Edit Mode" to edit</span>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="editor-workspace">
        {/* DOCX view mode — pixel-perfect fidelity via docx-preview */}
        {mode === 'docx-view' && docxBase64 && (
          <div className="editor-page-area" ref={docxContainerRef}>
            <DocxViewer
              fileBase64={docxBase64}
              onHtmlExtracted={(html) => {
                // Pre-load the HTML into TipTap so switching to edit is instant
                editor.commands.setContent(html)
              }}
            />
          </div>
        )}

        {/* Edit mode — TipTap */}
        {inEditMode && (
          <div className="editor-page-area">
            <div className="editor-page">
              <EditorContent editor={editor} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
