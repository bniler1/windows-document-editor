import { ipcMain, dialog } from 'electron'
import {
  createOcrJob,
  getOcrJob,
  getOcrJobProgress,
  cancelOcrJob,
  getOcrResult,
  getInstalledLanguages,
  mergeOcrTextToDocument,
} from '../services/ocrService'
import type { CreateOcrJobRequest } from '../../src/types'

export function registerOcrHandlers(): void {
  ipcMain.handle('ocr:createJob', (_e, req: CreateOcrJobRequest) => createOcrJob(req))

  ipcMain.handle('ocr:getJob', (_e, jobId: string) => getOcrJob(jobId))

  ipcMain.handle('ocr:getProgress', (_e, jobId: string) => getOcrJobProgress(jobId))

  ipcMain.handle('ocr:cancel', (_e, jobId: string) => cancelOcrJob(jobId))

  ipcMain.handle('ocr:getResult', (_e, jobId: string) => getOcrResult(jobId))

  ipcMain.handle('ocr:getLanguages', () => getInstalledLanguages())

  ipcMain.handle(
    'ocr:mergeText',
    (_e, jobId: string, targetDocumentId: string) =>
      mergeOcrTextToDocument(jobId, targetDocumentId),
  )

  ipcMain.handle('ocr:pickPdf', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select PDF for OCR',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })
}
