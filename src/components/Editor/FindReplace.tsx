import { useState, useCallback, useEffect } from 'react'
import type { Editor } from '@tiptap/react'

interface Props {
  editor: Editor
  onClose: () => void
}

export default function FindReplace({ editor, onClose }: Props) {
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [results, setResults] = useState<{ count: number; current: number }>({ count: 0, current: 0 })
  const [matches, setMatches] = useState<Array<{ from: number; to: number }>>([])
  const [currentIdx, setCurrentIdx] = useState(0)

  const findAll = useCallback((text: string): Array<{ from: number; to: number }> => {
    if (!text) return []
    const doc = editor.state.doc
    const found: Array<{ from: number; to: number }> = []
    const flags = caseSensitive ? 'g' : 'gi'

    let pattern: RegExp
    try {
      if (useRegex) {
        pattern = new RegExp(text, flags)
      } else {
        const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const bounded = wholeWord ? `\\b${escaped}\\b` : escaped
        pattern = new RegExp(bounded, flags)
      }
    } catch { return [] }

    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      let match: RegExpExecArray | null
      pattern.lastIndex = 0
      while ((match = pattern.exec(node.text)) !== null) {
        found.push({ from: pos + match.index, to: pos + match.index + match[0].length })
      }
    })
    return found
  }, [editor, caseSensitive, wholeWord, useRegex])

  useEffect(() => {
    const found = findAll(findText)
    setMatches(found)
    setResults({ count: found.length, current: found.length > 0 ? 1 : 0 })
    setCurrentIdx(0)

    if (found.length > 0) {
      editor.commands.setTextSelection({ from: found[0].from, to: found[0].to })
    }
  }, [findText, caseSensitive, wholeWord, useRegex, findAll, editor])

  const goNext = () => {
    if (!matches.length) return
    const idx = (currentIdx + 1) % matches.length
    setCurrentIdx(idx)
    setResults((r) => ({ ...r, current: idx + 1 }))
    editor.commands.setTextSelection({ from: matches[idx].from, to: matches[idx].to })
  }

  const goPrev = () => {
    if (!matches.length) return
    const idx = (currentIdx - 1 + matches.length) % matches.length
    setCurrentIdx(idx)
    setResults((r) => ({ ...r, current: idx + 1 }))
    editor.commands.setTextSelection({ from: matches[idx].from, to: matches[idx].to })
  }

  const replaceOne = () => {
    if (!matches.length) return
    const m = matches[currentIdx]
    editor.chain().focus()
      .setTextSelection({ from: m.from, to: m.to })
      .insertContent(replaceText)
      .run()
    // Re-find after replacement
    const newMatches = findAll(findText)
    setMatches(newMatches)
    setResults({ count: newMatches.length, current: Math.min(currentIdx + 1, newMatches.length) })
  }

  const replaceAll = () => {
    if (!matches.length) return
    // Process in reverse order so positions stay valid
    const sorted = [...matches].sort((a, b) => b.from - a.from)
    let chain = editor.chain().focus()
    for (const m of sorted) {
      chain = chain.setTextSelection({ from: m.from, to: m.to }).insertContent(replaceText) as typeof chain
    }
    chain.run()
    setMatches([])
    setResults({ count: 0, current: 0 })
  }

  return (
    <div className="find-replace-panel" role="dialog" aria-label="Find and Replace" aria-modal="false">
      <div className="fr-header">
        <span className="fr-title">Find &amp; Replace</span>
        <button onClick={onClose} aria-label="Close find & replace" className="fr-close">✕</button>
      </div>

      <div className="fr-row">
        <label htmlFor="fr-find">Find</label>
        <div className="fr-input-row">
          <input
            id="fr-find"
            type="text"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') goNext(); if (e.key === 'Escape') onClose() }}
            placeholder="Search text…"
            autoFocus
            aria-label="Find text"
          />
          {results.count > 0 && (
            <span className="fr-count" aria-live="polite">{results.current}/{results.count}</span>
          )}
          {findText && results.count === 0 && (
            <span className="fr-no-results" aria-live="polite">No results</span>
          )}
        </div>
        <div className="fr-nav-btns">
          <button onClick={goPrev} disabled={!matches.length} aria-label="Previous match">↑ Prev</button>
          <button onClick={goNext} disabled={!matches.length} aria-label="Next match">↓ Next</button>
        </div>
      </div>

      <div className="fr-row">
        <label htmlFor="fr-replace">Replace</label>
        <input
          id="fr-replace"
          type="text"
          value={replaceText}
          onChange={(e) => setReplaceText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          placeholder="Replacement text…"
          aria-label="Replace with"
        />
        <div className="fr-nav-btns">
          <button onClick={replaceOne} disabled={!matches.length}>Replace</button>
          <button onClick={replaceAll} disabled={!matches.length} className="btn-replace-all">Replace All</button>
        </div>
      </div>

      <div className="fr-options">
        <label>
          <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
          {' '}Match case
        </label>
        <label>
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
          {' '}Whole word
        </label>
        <label>
          <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
          {' '}Use regex
        </label>
      </div>
    </div>
  )
}
