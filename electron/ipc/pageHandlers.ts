import { ipcMain, dialog } from 'electron'
import {
  createSession,
  getSession,
  getSessionPages,
  rotatePages,
  reorderPages,
  deletePages,
  createExtractionJob,
  runExtractionJob,
  getExtractionJob,
  undoLastAction,
  applySessionToDocument,
  getDocumentPageOverrides,
} from '../services/pageService'
import type {
  CreateSessionRequest,
  RotateRequest,
  ReorderRequest,
  ExtractRequest,
  DeleteRequest,
  UndoRequest,
} from '../../src/types'

export function registerPageHandlers(): void {
  ipcMain.handle('page:createSession', (_e, req: CreateSessionRequest) =>
    createSession(
      req.documentId,
      req.sourcePageCount,
      req.sourceContentHash,
      req.documentVersionId,
    ),
  )

  ipcMain.handle('page:getSession', (_e, sessionId: string) => getSession(sessionId))

  ipcMain.handle('page:getPages', (_e, sessionId: string) => getSessionPages(sessionId))

  ipcMain.handle('page:rotate', (_e, req: RotateRequest) =>
    rotatePages(req.sessionId, req.pages, req.rotationDeg),
  )

  ipcMain.handle('page:reorder', (_e, req: ReorderRequest) =>
    reorderPages(req.sessionId, req.sourcePages, req.insertAfterPage),
  )

  ipcMain.handle('page:delete', (_e, req: DeleteRequest) =>
    deletePages(req.sessionId, req.pages),
  )

  ipcMain.handle('page:undo', (_e, req: UndoRequest) => undoLastAction(req.sessionId))

  ipcMain.handle(
    'page:extract',
    async (_e, req: ExtractRequest & { sourcePdfPath: string }) => {
      let dest = req.destinationPath
      if (!dest) {
        const result = await dialog.showSaveDialog({
          defaultPath: 'extracted-pages.pdf',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (result.canceled || !result.filePath) return null
        dest = result.filePath
      }
      const job = await createExtractionJob(
        req.sessionId,
        req.selectionSpec,
        dest,
        req.outputFormat,
        req.includeRotations,
        req.preserveOrder,
      )
      await runExtractionJob(job.id, req.sourcePdfPath)
      return getExtractionJob(job.id)
    },
  )

  ipcMain.handle('page:getExtractionJob', (_e, jobId: string) => getExtractionJob(jobId))

  ipcMain.handle('page:applySession', (_e, sessionId: string) =>
    applySessionToDocument(sessionId),
  )

  ipcMain.handle(
    'page:getOverrides',
    (_e, documentId: string, documentVersionId?: string) =>
      getDocumentPageOverrides(documentId, documentVersionId),
  )
}
