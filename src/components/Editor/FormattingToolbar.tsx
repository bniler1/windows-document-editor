import { useCallback, useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'

const FONT_SIZES = ['8','9','10','11','12','14','16','18','20','22','24','28','32','36','48','72']
const SYSTEM_FONTS = [
  'Arial','Arial Black','Calibri','Cambria','Comic Sans MS','Courier New',
  'Georgia','Helvetica','Impact','Segoe UI','Tahoma','Times New Roman',
  'Trebuchet MS','Verdana',
]
const HEADING_LEVELS = [
  { label: 'Normal', value: 'paragraph' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Heading 4', value: 'h4' },
  { label: 'Heading 5', value: 'h5' },
  { label: 'Heading 6', value: 'h6' },
]

interface Props { editor: Editor; onFindReplace: () => void }

export default function FormattingToolbar({ editor, onFindReplace }: Props) {
  const [fontOpen, setFontOpen] = useState(false)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [caseOpen, setCaseOpen] = useState(false)
  const [customSize, setCustomSize] = useState('12')
  const colorInputRef = useRef<HTMLInputElement>(null)
  const hlInputRef = useRef<HTMLInputElement>(null)

  const currentFont = editor.getAttributes('textStyle').fontFamily ?? 'Arial'
  const currentSize = (() => {
    const fs = editor.getAttributes('textStyle').fontSize
    if (!fs) return '12'
    return fs.replace(/pt|px|em/g, '')
  })()

  const currentStyle = (() => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive('heading', { level: i })) return `h${i}`
    }
    return 'paragraph'
  })()

  // Close all dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.tb-dropdown') && !target.closest('.tb-btn')) {
        setFontOpen(false); setSizeOpen(false); setStyleOpen(false); setCaseOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const setFont = (f: string) => { editor.chain().focus().setFontFamily(f).run(); setFontOpen(false) }
  const setSize = useCallback((s: string) => {
    const n = Math.max(6, Math.min(200, parseInt(s, 10) || 12))
    editor.chain().focus().setMark('textStyle', { fontSize: `${n}pt` }).run()
    setCustomSize(String(n)); setSizeOpen(false)
  }, [editor])

  const setStyle = (val: string) => {
    if (val === 'paragraph') editor.chain().focus().setParagraph().run()
    else editor.chain().focus().toggleHeading({ level: parseInt(val[1]) as 1|2|3|4|5|6 }).run()
    setStyleOpen(false)
  }

  const TB = ({ action, label, kbd, active, disabled, children }: {
    action: () => void; label: string; kbd: string
    active?: boolean; disabled?: boolean; children: React.ReactNode
  }) => (
    <button onClick={action} disabled={disabled} aria-label={label} aria-pressed={active}
      title={kbd ? `${label} (${kbd})` : label}
      className={`tb-btn ${active ? 'active' : ''}`}>
      {children}
    </button>
  )

  return (
    <div className="formatting-toolbar" role="toolbar" aria-label="Formatting toolbar">
      {/* Row 1 */}
      <div className="tb-row">
        {/* Undo/Redo */}
        <TB action={() => editor.chain().focus().undo().run()} label="Undo" kbd="Ctrl+Z" disabled={!editor.can().undo()}>↩</TB>
        <TB action={() => editor.chain().focus().redo().run()} label="Redo" kbd="Ctrl+Y" disabled={!editor.can().redo()}>↪</TB>
        <div className="tb-sep"/>

        {/* Style / Heading picker */}
        <div style={{position:'relative'}}>
          <button className="tb-btn tb-style-picker" onClick={() => {setStyleOpen(v=>!v); setFontOpen(false); setSizeOpen(false)}}
            aria-haspopup="listbox" aria-expanded={styleOpen}>
            {HEADING_LEVELS.find(h=>h.value===currentStyle)?.label ?? 'Normal'} <span style={{fontSize:9}}>▾</span>
          </button>
          {styleOpen && (
            <div className="tb-dropdown" style={{minWidth:130}} role="listbox">
              {HEADING_LEVELS.map(h => (
                <button key={h.value} role="option" aria-selected={currentStyle===h.value}
                  className={`tb-dropdown-item ${currentStyle===h.value?'selected':''}`}
                  style={h.value!=='paragraph'?{fontSize:`${1.4-parseInt(h.value[1])*0.1}em`,fontWeight:'bold'}:{}}
                  onClick={() => setStyle(h.value)}>{h.label}</button>
              ))}
            </div>
          )}
        </div>

        {/* Font family */}
        <div style={{position:'relative'}}>
          <button className="tb-btn tb-font-picker" style={{fontFamily:currentFont}}
            onClick={() => {setFontOpen(v=>!v); setSizeOpen(false); setStyleOpen(false)}}
            aria-haspopup="listbox" aria-expanded={fontOpen}>
            <span style={{maxWidth:100,overflow:'hidden',textOverflow:'ellipsis',display:'inline-block'}}>{currentFont}</span>
            <span style={{marginLeft:3,fontSize:9}}>▾</span>
          </button>
          {fontOpen && (
            <div className="tb-dropdown" role="listbox">
              {SYSTEM_FONTS.map(f => (
                <button key={f} role="option" aria-selected={currentFont===f}
                  className={`tb-dropdown-item ${currentFont===f?'selected':''}`}
                  style={{fontFamily:f}} onClick={() => setFont(f)}>{f}</button>
              ))}
            </div>
          )}
        </div>

        {/* Font size */}
        <div style={{position:'relative'}}>
          <div className="tb-size-picker">
            <input type="number" value={customSize} min={6} max={200} aria-label="Font size"
              className="tb-size-input"
              onChange={e => setCustomSize(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter') setSize(customSize) }}
              onBlur={() => setSize(customSize)}/>
            <button className="tb-size-arrow" onClick={() => {setSizeOpen(v=>!v); setFontOpen(false); setStyleOpen(false)}}
              aria-haspopup="listbox" aria-expanded={sizeOpen}>▾</button>
          </div>
          {sizeOpen && (
            <div className="tb-dropdown tb-dropdown-sm" role="listbox">
              {FONT_SIZES.map(s => (
                <button key={s} role="option" className={`tb-dropdown-item ${currentSize===s?'selected':''}`}
                  onClick={() => setSize(s)}>{s}</button>
              ))}
            </div>
          )}
        </div>

        <TB action={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} label="Clear Formatting" kbd="">✖</TB>
        <div className="tb-sep"/>

        {/* Bold / Italic / Underline / Strike */}
        <TB action={() => editor.chain().focus().toggleBold().run()} label="Bold" kbd="Ctrl+B" active={editor.isActive('bold')}><b>B</b></TB>
        <TB action={() => editor.chain().focus().toggleItalic().run()} label="Italic" kbd="Ctrl+I" active={editor.isActive('italic')}><i>I</i></TB>
        <TB action={() => editor.chain().focus().toggleUnderline().run()} label="Underline" kbd="Ctrl+U" active={editor.isActive('underline')}><u>U</u></TB>
        <TB action={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough" kbd="Ctrl+Shift+X" active={editor.isActive('strike')}><s>S</s></TB>
        <TB action={() => editor.chain().focus().toggleSuperscript().run()} label="Superscript" kbd="" active={editor.isActive('superscript')}>x²</TB>
        <TB action={() => editor.chain().focus().toggleSubscript().run()} label="Subscript" kbd="" active={editor.isActive('subscript')}>x₂</TB>
        <div className="tb-sep"/>

        {/* Colors */}
        <label className="tb-btn tb-color-btn" title="Text Color" aria-label="Text color">
          <span style={{borderBottom:`3px solid ${editor.getAttributes('textStyle').color||'#000'}`,paddingBottom:1}}>A</span>
          <input ref={colorInputRef} type="color" value={editor.getAttributes('textStyle').color||'#000000'}
            onChange={e => editor.chain().focus().setColor(e.target.value).run()}
            style={{opacity:0,position:'absolute',width:0,height:0}}/>
        </label>
        <label className="tb-btn tb-color-btn" title="Highlight Color" aria-label="Highlight color">
          <span style={{background:editor.getAttributes('highlight').color||'#ffff00',padding:'0 2px',borderRadius:2}}>H</span>
          <input ref={hlInputRef} type="color" defaultValue="#ffff00"
            onChange={e => editor.chain().focus().toggleHighlight({color:e.target.value}).run()}
            style={{opacity:0,position:'absolute',width:0,height:0}}/>
        </label>
        <div className="tb-sep"/>

        {/* Alignment */}
        <TB action={() => editor.chain().focus().setTextAlign('left').run()} label="Align Left" kbd="Ctrl+L" active={editor.isActive({textAlign:'left'})}>⬤ L</TB>
        <TB action={() => editor.chain().focus().setTextAlign('center').run()} label="Center" kbd="Ctrl+E" active={editor.isActive({textAlign:'center'})}>⬤ C</TB>
        <TB action={() => editor.chain().focus().setTextAlign('right').run()} label="Align Right" kbd="Ctrl+R" active={editor.isActive({textAlign:'right'})}>⬤ R</TB>
        <TB action={() => editor.chain().focus().setTextAlign('justify').run()} label="Justify" kbd="Ctrl+J" active={editor.isActive({textAlign:'justify'})}>≡</TB>
        <div className="tb-sep"/>

        {/* Lists + Indent */}
        <TB action={() => editor.chain().focus().toggleBulletList().run()} label="Bullet List" kbd="Ctrl+Shift+L" active={editor.isActive('bulletList')}>•≡</TB>
        <TB action={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered List" kbd="Ctrl+Shift+7" active={editor.isActive('orderedList')}>1≡</TB>
        <TB action={() => editor.chain().focus().sinkListItem('listItem').run()} label="Increase Indent" kbd="Tab">→|</TB>
        <TB action={() => editor.chain().focus().liftListItem('listItem').run()} label="Decrease Indent" kbd="Shift+Tab">|←</TB>
        <TB action={() => editor.chain().focus().toggleBlockquote().run()} label="Blockquote" kbd="" active={editor.isActive('blockquote')}>"</TB>
        <div className="tb-sep"/>

        {/* Change Case */}
        <div style={{position:'relative'}}>
          <button
            className="tb-btn"
            onClick={() => { setCaseOpen(v=>!v); setFontOpen(false); setSizeOpen(false); setStyleOpen(false) }}
            title="Change Case"
            aria-haspopup="listbox"
            aria-expanded={caseOpen}
            aria-label="Change text case"
          >
            Aa ▾
          </button>
          {caseOpen && (
            <div className="tb-dropdown" style={{minWidth:180}} role="listbox" aria-label="Case options">
              {[
                { label: 'UPPERCASE', fn: (s: string) => s.toUpperCase() },
                { label: 'lowercase', fn: (s: string) => s.toLowerCase() },
                { label: 'Title Case', fn: (s: string) => s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) },
                { label: 'Sentence case', fn: (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() },
                { label: 'tOGGLE cASE', fn: (s: string) => s.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('') },
              ].map(({ label, fn }) => (
                <button
                  key={label}
                  role="option"
                  className="tb-dropdown-item"
                  onClick={() => {
                    const { from, to, empty } = editor.state.selection
                    if (empty) {
                      // No selection — transform the word at cursor
                      editor.chain().focus().extendMarkRange('textStyle').command(({ tr, state }) => {
                        const wordFrom = state.doc.resolve(from).before()
                        const wordTo = state.doc.resolve(to).after()
                        const text = state.doc.textBetween(wordFrom, wordTo)
                        tr.insertText(fn(text), wordFrom, wordTo)
                        return true
                      }).run()
                    } else {
                      const text = editor.state.doc.textBetween(from, to, ' ')
                      editor.chain().focus().insertContentAt({ from, to }, fn(text)).run()
                    }
                    setCaseOpen(false)
                  }}
                >{label}</button>
              ))}
            </div>
          )}
        </div>
        <div className="tb-sep"/>

        {/* Insert */}
        <TB action={() => {
          const url = prompt('Enter URL:')
          if (url) editor.chain().focus().setLink({href:url}).run()
        }} label="Insert Link" kbd="Ctrl+K" active={editor.isActive('link')}>🔗</TB>
        <TB action={() => editor.chain().focus().insertTable({rows:3,cols:3,withHeaderRow:true}).run()} label="Insert Table" kbd="">⊞</TB>
        <label className="tb-btn" title="Insert Image" aria-label="Insert image">
          🖼<input type="file" accept="image/*" style={{opacity:0,position:'absolute',width:0,height:0}}
            onChange={e => {
              const f = e.target.files?.[0]; if (!f) return
              const r = new FileReader()
              r.onload = ev => { if (ev.target?.result) editor.chain().focus().setImage({src:ev.target.result as string}).run() }
              r.readAsDataURL(f); e.target.value=''
            }}/>
        </label>
        <TB action={() => editor.chain().focus().setHorizontalRule().run()} label="Horizontal Rule" kbd="">─</TB>
        <TB action={() => editor.chain().focus().toggleCodeBlock().run()} label="Code Block" kbd="Ctrl+Alt+C" active={editor.isActive('codeBlock')}>{'</>'}</TB>
        <div className="tb-sep"/>

        {/* Find & Replace */}
        <TB action={onFindReplace} label="Find & Replace" kbd="Ctrl+H">🔍</TB>
        <TB action={() => window.print()} label="Print" kbd="Ctrl+P">🖨</TB>
      </div>
    </div>
  )
}
