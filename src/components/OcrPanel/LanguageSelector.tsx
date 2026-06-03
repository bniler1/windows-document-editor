import { useState, useEffect } from 'react'

interface Language {
  code: string
  name: string
}

interface Props {
  selected: string[]
  onChange: (languages: string[]) => void
}

export default function LanguageSelector({ selected, onChange }: Props) {
  const [languages, setLanguages] = useState<Language[]>([])

  useEffect(() => {
    window.ocrApi.getLanguages().then((langs: Language[]) => setLanguages(langs))
  }, [])

  const toggle = (code: string) => {
    if (selected.includes(code)) {
      if (selected.length > 1) onChange(selected.filter((c) => c !== code))
    } else if (selected.length < 3) {
      onChange([...selected, code])
    }
  }

  return (
    <div className="lang-selector" role="group" aria-label="OCR languages (select up to 3)">
      <label className="lang-selector-label">Languages (up to 3)</label>
      <div className="lang-list">
        {languages.map((lang) => (
          <label key={lang.code} className="lang-option">
            <input
              type="checkbox"
              checked={selected.includes(lang.code)}
              disabled={!selected.includes(lang.code) && selected.length >= 3}
              onChange={() => toggle(lang.code)}
            />
            {' '}
            {lang.name}
          </label>
        ))}
      </div>
    </div>
  )
}
