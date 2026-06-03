import { ipcMain, dialog } from 'electron'
import { compressPdf, getPdfFileStats } from '../services/compressService'
import type { CompressOptions } from '../services/compressService'

export function registerCompressHandlers(): void {
  ipcMain.handle(
    'pdf:compress',
    async (_e, inputPath: string, options?: Partial<CompressOptions>) => {
      const result = await dialog.showSaveDialog({
        defaultPath: 'compressed.pdf',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return null
      return compressPdf(inputPath, result.filePath, options)
    },
  )

  ipcMain.handle('pdf:compressTo', (_e, inputPath: string, outputPath: string, options?: Partial<CompressOptions>) =>
    compressPdf(inputPath, outputPath, options),
  )

  ipcMain.handle('pdf:fileStats', (_e, filePath: string) => getPdfFileStats(filePath))
}
