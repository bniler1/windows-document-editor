import { ipcMain, dialog } from 'electron'
import { runImportJob, cancelImportJob } from '../services/pdfImportService'
import { listJobs, getJob, deleteJob, getJobMetrics, getAnomalies } from '../services/pdfImportRepository'
import type { ImportMode } from '../services/pdfImportRepository'

export function registerPdfImportHandlers(): void {
  ipcMain.handle('pdfImport:start', async (_e, req: {
    pdfPath?: string
    password?: string
    mode?: ImportMode
    pageRange?: { start: number; end: number }
    ocrEnabled?: boolean
    preservePageBreaks?: boolean
    detectLists?: boolean
    reconstructTables?: boolean
  }) => {
    let pdfPath = req.pdfPath
    if (!pdfPath) {
      const result = await dialog.showOpenDialog({
        title: 'Import PDF',
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths[0]) return null
      pdfPath = result.filePaths[0]
    }
    return runImportJob({ ...req, pdfPath })
  })

  ipcMain.handle('pdfImport:cancel', (_e, jobId: string) => cancelImportJob(jobId))

  ipcMain.handle('pdfImport:listJobs', (_e, limit?: number, offset?: number) =>
    listJobs(limit, offset),
  )

  ipcMain.handle('pdfImport:getJob', (_e, jobId: string) => getJob(jobId))

  ipcMain.handle('pdfImport:getMetrics', (_e, jobId: string) => getJobMetrics(jobId))

  ipcMain.handle('pdfImport:getAnomalies', (_e, jobId: string) => getAnomalies(jobId))

  ipcMain.handle('pdfImport:deleteJob', (_e, jobId: string) => deleteJob(jobId))
}
