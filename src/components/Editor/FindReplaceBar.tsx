import { useState, useCallback, useEffect, useRef } from 'react'
import type { Editor } from '@tiptap/react'

interface Props {
  editor: Editor | null
  // For non-TipTap content (docx-preview rendered HTML)
  container?: HTMLElement | null
}

export default function FindReplaceBar({ editor, container }: Props) {
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [showReplace, setShowReplace] = useState(false)
  const [matchCount, setMatchCount] = useState(0)
  const [currentMatch, setCurrentMatch] = useState(0)
  const [tiptapMatches, setTiptapMatches] = useState<Array<{from:number;to:number}>>([])
  const [domMatches, setDomMatches] = useState<Array<HTMLElement>>([])
  const currentIdx = useRef(0)
  const findInputRef = useRef<HTMLInputElement>(null)

  // ── TipTap search ────────────────────────────────────────────
  const findInTipTap = useCallback((text: string) => {
    if (!editor || !text) { setTiptapMatches([]); setMatchCount(0); return }
    const doc = editor.state.doc
    const found: Array<{from:number;to:number}> = []
    const flags = caseSensitive ? 'g' : 'gi'
    let pattern: RegExp
    try {
      const escaped = useRegex ? text : text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
      const bounded = wholeWord ? `\\b${escaped}\\b` : escaped
      pattern = new RegExp(bounded, flags)
    } catch { setMatchCount(0); return }

    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      pattern.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.exec(node.text)) !== null) {
        found.push({ from: pos + m.index, to: pos + m.index + m[0].length })
      }
    })
    setTiptapMatches(found)
    setMatchCount(found.length)
    currentIdx.current = 0
    if (found.length > 0) {
      setCurrentMatch(1)
      editor.commands.setTextSelection({ from: found[0].from, to: found[0].to })
      scrollToCursor(editor)
    } else setCurrentMatch(0)
  }, [editor, caseSensitive, wholeWord, useRegex])

  // ── DOM search (docx-preview content) ───────────────────────
  const findInDom = useCallback((text: string) => {
    if (!container || !text) {
      domMatches.forEach(el => el.classList.remove('find-highlight', 'find-highlight-current'))
      setDomMatches([]); setMatchCount(0); return
    }

    // Remove previous highlights
    container.querySelectorAll('.find-highlight').forEach(el => {
      const parent = el.parentNode
      if (parent) { parent.replaceChild(document.createTextNode(el.textContent ?? ''), el) }
    })

    const flags = caseSensitive ? 'g' : 'gi'
    let pattern: RegExp
    try {
      const escaped = useRegex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const bounded = wholeWord ? `\\b${escaped}\\b` : escaped
      pattern = new RegExp(bounded, flags)
    } catch { return }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) textNodes.push(node)

    const newMatches: HTMLElement[] = []
    for (const tn of textNodes) {
      const val = tn.nodeValue ?? ''
      if (!pattern.test(val)) continue
      pattern.lastIndex = 0

      const frag = document.createDocumentFragment()
      let last = 0, m: RegExpExecArray | null
      while ((m = pattern.exec(val)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(val.slice(last, m.index)))
        const span = document.createElement('mark')
        span.className = 'find-highlight'
        span.textContent = m[0]
        frag.appendChild(span)
        newMatches.push(span)
        last = m.index + m[0].length
      }
      if (last < val.length) frag.appendChild(document.createTextNode(val.slice(last)))
      tn.parentNode?.replaceChild(frag, tn)
    }

    setDomMatches(newMatches)
    setMatchCount(newMatches.length)
    currentIdx.current = 0
    if (newMatches.length > 0) {
      setCurrentMatch(1)
      newMatches[0].classList.add('find-highlight-current')
      newMatches[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    } else setCurrentMatch(0)
  }, [container, caseSensitive, wholeWord, useRegex])

  useEffect(() => {
    if (editor) findInTipTap(findText)
    else if (container) findInDom(findText)
  }, [findText, caseSensitive, wholeWord, useRegex, editor, container, findInTipTap, findInDom])

  const goNext = () => {
    if (editor && tiptapMatches.length) {
      const idx = (currentIdx.current + 1) % tiptapMatches.length
      currentIdx.current = idx
      setCurrentMatch(idx + 1)
      editor.commands.setTextSelection({ from: tiptapMatches[idx].from, to: tiptapMatches[idx].to })
      scrollToCursor(editor)
    } else if (domMatches.length) {
      domMatches[currentIdx.current].classList.remove('find-highlight-current')
      const idx = (currentIdx.current + 1) % domMatches.length
      currentIdx.current = idx
      setCurrentMatch(idx + 1)
      domMatches[idx].classList.add('find-highlight-current')
      domMatches[idx].scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  const goPrev = () => {
    if (editor && tiptapMatches.length) {
      const idx = (currentIdx.current - 1 + tiptapMatches.length) % tiptapMatches.length
      currentIdx.current = idx
      setCurrentMatch(idx + 1)
      editor.commands.setTextSelection({ from: tiptapMatches[idx].from, to: tiptapMatches[idx].to })
      scrollToCursor(editor)
    } else if (domMatches.length) {
      domMatches[currentIdx.current].classList.remove('find-highlight-current')
      const idx = (currentIdx.current - 1 + domMatches.length) % domMatches.length
      currentIdx.current = idx
      setCurrentMatch(idx + 1)
      domMatches[idx].classList.add('find-highlight-current')
      domMatches[idx].scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  const replaceOne = () => {
    if (!editor || !tiptapMatches.length) return
    const m = tiptapMatches[currentIdx.current]
    editor.chain().focus().setTextSelection({ from: m.from, to: m.to }).insertContent(replaceText).run()
    findInTipTap(findText)
  }

  const replaceAll = () => {
    if (!editor || !tiptapMatches.length) return
    const sorted = [...tiptapMatches].sort((a, b) => b.from - a.from)
    editor.chain().focus().command(({ tr }) => {
      for (const { from, to } of sorted) tr.insertText(replaceText, from, to)
      return true
    }).run()
    findInTipTap(findText)
  }

  const hasMatches = matchCount > 0
  const noResult = findText.length > 0 && matchCount === 0

  return (
    <div className="find-replace-bar" role="search" aria-label="Find and Replace">
      <div className="frb-toggle-row">
        <button
          className={`frb-toggle ${!showReplace ? 'active' : ''}`}
          onClick={() => setShowReplace(false)}
          aria-pressed={!showReplace}
        >Find</button>
        <button
          className={`frb-toggle ${showReplace ? 'active' : ''}`}
          onClick={() => setShowReplace(true)}
          aria-pressed={showReplace}
        >Replace</button>
      </div>

      <div className="frb-row">
        <div className={`frb-input-wrap ${noResult ? 'no-result' : ''}`}>
          <input
            ref={findInputRef}
            type="text"
            value={findText}
            onChange={e => setFindText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') e.shiftKey ? goPrev() : goNext()
              if (e.key === 'Escape') setFindText('')
            }}
            placeholder="Find…"
            aria-label="Find text"
            aria-describedby="frb-count"
          />
          {findText && (
            <span id="frb-count" className={`frb-count ${noResult ? 'none' : ''}`} aria-live="polite">
              {noResult ? 'No results' : `${currentMatch}/${matchCount}`}
            </span>
          )}
        </div>

        <div className="frb-btns">
          <button onClick={goPrev} disabled={!hasMatches} aria-label="Previous match" title="Previous (Shift+Enter)">↑</button>
          <button onClick={goNext} disabled={!hasMatches} aria-label="Next match" title="Next (Enter)">↓</button>
        </div>

        <div className="frb-options">
          <label title="Match case">
            <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />
            Aa
          </label>
          <label title="Whole word">
            <input type="checkbox" checked={wholeWord} onChange={e => setWholeWord(e.target.checked)} />
            W
          </label>
          <label title="Regular expression">
            <input type="checkbox" checked={useRegex} onChange={e => setUseRegex(e.target.checked)} />
            .*
          </label>
        </div>
      </div>

      {showReplace && (
        <div className="frb-row frb-replace-row">
          <input
            type="text"
            value={replaceText}
            onChange={e => setReplaceText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setReplaceText('') }}
            placeholder="Replace with…"
            aria-label="Replace with"
            className="frb-replace-input"
          />
          <div className="frb-btns">
            <button onClick={replaceOne} disabled={!hasMatches || !editor} aria-label="Replace">Replace</button>
            <button onClick={replaceAll} disabled={!hasMatches || !editor} className="frb-replace-all" aria-label="Replace all">All</button>
          </div>
        </div>
      )}
    </div>
  )
}

function scrollToCursor(editor: Editor) {
  const { from } = editor.state.selection
  const node = editor.view.domAtPos(from).node as HTMLElement
  node?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
}
