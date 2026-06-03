import { ipcMain, dialog } from 'electron'
import fs from 'fs'
import crypto from 'crypto'

export function registerFileHandlers(): void {
  // Read file as base64 for renderer
  ipcMain.handle('file:read', (_e, filePath: string) => {
    if (!fs.existsSync(filePath)) throw new Error(`FILE_NOT_FOUND: ${filePath}`)
    const bytes = fs.readFileSync(filePath)
    return {
      base64: bytes.toString('base64'),
      size: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      pageCount: estimatePageCount(bytes),
    }
  })

  // Save bytes written from renderer back to a file
  ipcMain.handle('file:write', (_e, filePath: string, base64: string) => {
    const bytes = Buffer.from(base64, 'base64')
    fs.writeFileSync(filePath, bytes)
    return { size: bytes.length }
  })

  // Open-file dialog (PDF, DOCX, TXT, Markdown)
  ipcMain.handle('file:openDialog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Document',
      filters: [
        { name: 'All Documents', extensions: ['pdf','docx','doc','txt','md'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'Word Documents', extensions: ['docx','doc'] },
        { name: 'Text Files', extensions: ['txt','md'] },
      ],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Save-file dialog
  ipcMain.handle('file:saveDialog', async (_e, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName ?? 'document.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    return result.canceled ? null : result.filePath
  })

  // Get file metadata without reading full bytes
  ipcMain.handle('file:stat', (_e, filePath: string) => {
    if (!fs.existsSync(filePath)) return null
    const s = fs.statSync(filePath)
    return { size: s.size, mtime: s.mtime.toISOString() }
  })
}

function estimatePageCount(bytes: Buffer): number {
  const str = bytes.toString('latin1')
  const match = str.match(/\/Count\s+(\d+)/)
  if (match) return parseInt(match[1], 10)
  const pages = str.match(/\/Type\s*\/Page[^s]/g)
  return pages ? pages.length : 1
}
