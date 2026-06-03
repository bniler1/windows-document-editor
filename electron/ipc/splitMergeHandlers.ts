import { ipcMain, dialog } from 'electron'
import { splitPdf, mergePdfs, getPdfStats, parsePageRange } from '../services/splitMergeService'
import type { SplitRequest, MergeRequest } from '../services/splitMergeService'

export function registerSplitMergeHandlers(): void {
  ipcMain.handle('pdf:split', async (_e, req: SplitRequest) => {
    if (!req.outputDir) {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return null
      req.outputDir = result.filePaths[0]
    }
    return splitPdf(req)
  })

  ipcMain.handle('pdf:merge', async (_e, req: MergeRequest) => {
    if (!req.outputPath) {
      const result = await dialog.showSaveDialog({
        defaultPath: 'merged.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return null
      req.outputPath = result.filePath
    }
    return mergePdfs(req)
  })

  ipcMain.handle('pdf:stats', (_e, filePath: string) => getPdfStats(filePath))

  ipcMain.handle('pdf:parseRange', (_e, spec: string, totalPages: number) =>
    parsePageRange(spec, totalPages),
  )

  ipcMain.handle('pdf:pickFiles', async () => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile', 'multiSelections'],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('pdf:pickSave', async (_e, defaultName?: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName ?? 'output.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    return result.canceled ? null : result.filePath
  })
}
