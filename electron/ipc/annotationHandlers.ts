import { ipcMain, dialog } from 'electron'
import {
  upsertWatermark,
  getWatermark,
  removeWatermark,
  applyWatermarkToPdf,
  addAnnotation,
  getAnnotations,
  updateAnnotation,
  deleteAnnotation,
  applyRedactionsToPdf,
  flattenAnnotationsToPdf,
  ensureAnnotationTables,
} from '../services/annotationService'
import type { WatermarkConfig, AnnotationRecord } from '../services/annotationService'

export function registerAnnotationHandlers(): void {
  ensureAnnotationTables()

  // Watermark
  ipcMain.handle('ann:upsertWatermark', (_e, config: WatermarkConfig) => upsertWatermark(config))
  ipcMain.handle('ann:getWatermark', (_e, documentId: string) => getWatermark(documentId))
  ipcMain.handle('ann:removeWatermark', (_e, documentId: string) => removeWatermark(documentId))
  ipcMain.handle('ann:applyWatermark', async (_e, inputPath: string, config: WatermarkConfig) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'watermarked.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null
    await applyWatermarkToPdf(inputPath, result.filePath, config)
    return result.filePath
  })

  // Annotations
  ipcMain.handle(
    'ann:add',
    (_e, documentId: string, pageNumber: number, type: AnnotationRecord['type'],
     bounds: { x: number; y: number; width: number; height: number },
     opts?: { color?: string; content?: string; author?: string; parentId?: string }) =>
      addAnnotation(documentId, pageNumber, type, bounds, opts),
  )
  ipcMain.handle('ann:getAll', (_e, documentId: string, pageNumber?: number) =>
    getAnnotations(documentId, pageNumber),
  )
  ipcMain.handle('ann:update', (_e, id: string, updates: Partial<Pick<AnnotationRecord, 'content' | 'color' | 'status'>>) =>
    updateAnnotation(id, updates),
  )
  ipcMain.handle('ann:delete', (_e, id: string) => deleteAnnotation(id))

  // Redaction
  ipcMain.handle('ann:applyRedactions', async (_e, inputPath: string, documentId: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'redacted.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null
    const stats = await applyRedactionsToPdf(inputPath, result.filePath, documentId)
    return { ...stats, outputPath: result.filePath }
  })

  ipcMain.handle('ann:flattenAnnotations', async (_e, inputPath: string, documentId: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: 'annotated.pdf',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return null
    const stats = await flattenAnnotationsToPdf(inputPath, result.filePath, documentId)
    return { ...stats, outputPath: result.filePath }
  })
}
