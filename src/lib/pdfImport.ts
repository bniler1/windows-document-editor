import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface RichTextItem {
  text: string
  x: number
  y: number
  fontSize: number
  fontName: string
  bold: boolean
  italic: boolean
  pageNum: number
}

interface LineGroup {
  y: number
  items: RichTextItem[]
  avgFontSize: number
}

export async function importPdfAsHtml(pdfPath: string): Promise<string> {
  const { base64 } = await window.fileApi.read(pdfPath)
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise

  let allHtml = ''

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })
    const pageHeight = viewport.height

    // Extract rich text items
    const richItems: RichTextItem[] = []
    for (const rawItem of content.items) {
      if (!('str' in rawItem) || !rawItem.str.trim()) continue
      const item = rawItem as TextItem

      // Extract font size from transform matrix: [a,b,c,d,e,f]
      // font size ≈ Math.sqrt(a² + b²) or Math.abs(d)
      const [a, b, , d, x, y] = item.transform
      const fontSize = Math.round(Math.sqrt(a * a + b * b) || Math.abs(d) || 12)
      const fontName = item.fontName ?? ''
      const bold = /bold|black|heavy|demi/i.test(fontName)
      const italic = /italic|oblique/i.test(fontName)

      richItems.push({
        text: item.str,
        x: Math.round(x),
        y: Math.round(pageHeight - y),  // flip to top-down
        fontSize: Math.max(1, fontSize),
        fontName,
        bold,
        italic,
        pageNum,
      })
    }

    if (richItems.length === 0) continue

    // Group items into lines by y-position (within 3px tolerance)
    const lines = groupIntoLines(richItems)

    // Detect document-level font sizes to determine heading thresholds
    const allSizes = richItems.map(i => i.fontSize).sort((a, b) => a - b)
    const bodySize = percentile(allSizes, 50)  // median = body text size
    const h1Threshold = bodySize * 2.0
    const h2Threshold = bodySize * 1.5
    const h3Threshold = bodySize * 1.2

    // Convert lines to HTML
    const pageHtml = linesToHtml(lines, bodySize, h1Threshold, h2Threshold, h3Threshold)
    allHtml += pageHtml

    if (pageNum < doc.numPages) allHtml += '<hr/>'
    page.cleanup()
  }

  doc.destroy()
  return allHtml || '<p>No readable text found. This PDF may be scanned — use OCR first.</p>'
}

function groupIntoLines(items: RichTextItem[]): LineGroup[] {
  const lineMap = new Map<number, RichTextItem[]>()
  const TOLERANCE = 4

  for (const item of items) {
    let matched = false
    for (const [ky] of lineMap) {
      if (Math.abs(ky - item.y) <= TOLERANCE) {
        lineMap.get(ky)!.push(item)
        matched = true
        break
      }
    }
    if (!matched) lineMap.set(item.y, [item])
  }

  return [...lineMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([y, items]) => {
      // Sort items left-to-right within each line
      items.sort((a, b) => a.x - b.x)
      const avgFontSize = items.reduce((s, i) => s + i.fontSize, 0) / items.length
      return { y, items, avgFontSize }
    })
}

function linesToHtml(
  lines: LineGroup[],
  bodySize: number,
  h1Threshold: number,
  h2Threshold: number,
  h3Threshold: number,
): string {
  let html = ''
  let inList = false

  // Detect likely list items (short lines starting with bullet chars or numbers)
  const listPatterns = /^[•●◦‣•\-–—*]\s+|^\d+[.)]\s+/

  for (const line of lines) {
    const lineText = line.items.map(i => i.str ?? i.text).join('')
    if (!lineText.trim()) {
      if (inList) { html += '</ul>'; inList = false }
      html += '<p>&nbsp;</p>'
      continue
    }

    const avgSize = line.avgFontSize
    const isBold = line.items.every(i => i.bold)
    const isItalic = line.items.every(i => i.italic)

    // Build inline HTML for mixed-format line
    const inlineHtml = buildInlineHtml(line.items)

    if (avgSize >= h1Threshold || (avgSize > h2Threshold && isBold)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h1>${inlineHtml}</h1>`
    } else if (avgSize >= h2Threshold) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h2>${inlineHtml}</h2>`
    } else if (avgSize >= h3Threshold && isBold) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h3>${inlineHtml}</h3>`
    } else if (listPatterns.test(lineText)) {
      const clean = lineText.replace(listPatterns, '').trim()
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${escapeHtml(clean)}</li>`
    } else {
      if (inList) { html += '</ul>'; inList = false }
      // Wrap in paragraph, preserving inline bold/italic
      html += `<p style="font-size:${Math.round(avgSize)}pt">${inlineHtml}</p>`
    }
  }

  if (inList) html += '</ul>'
  return html
}

function buildInlineHtml(items: RichTextItem[]): string {
  let html = ''
  for (const item of items) {
    let t = escapeHtml(item.text)
    if (!t) continue

    // Apply font size if significantly different from neighbors
    const style = `font-size:${item.fontSize}pt`
    t = `<span style="${style}">${t}</span>`
    if (item.bold && item.italic) t = `<strong><em>${t}</em></strong>`
    else if (item.bold) t = `<strong>${t}</strong>`
    else if (item.italic) t = `<em>${t}</em>`
    html += t
  }
  return html
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 12
  const idx = Math.floor((p / 100) * sorted.length)
  return sorted[Math.min(idx, sorted.length - 1)]
}
