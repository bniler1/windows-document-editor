import { contextBridge, ipcRenderer } from 'electron'
import type {
  CreateSessionRequest, RotateRequest, ReorderRequest,
  ExtractRequest, DeleteRequest, UndoRequest, CreateOcrJobRequest,
} from '../src/types'
import type { SplitRequest, MergeRequest } from './services/splitMergeService'
import type { CompressOptions } from './services/compressService'
import type { WatermarkConfig, AnnotationRecord } from './services/annotationService'

const pageApi = {
  createSession: (req: CreateSessionRequest) => ipcRenderer.invoke('page:createSession', req),
  getSession: (id: string) => ipcRenderer.invoke('page:getSession', id),
  getPages: (id: string) => ipcRenderer.invoke('page:getPages', id),
  rotate: (req: RotateRequest) => ipcRenderer.invoke('page:rotate', req),
  reorder: (req: ReorderRequest) => ipcRenderer.invoke('page:reorder', req),
  delete: (req: DeleteRequest) => ipcRenderer.invoke('page:delete', req),
  undo: (req: UndoRequest) => ipcRenderer.invoke('page:undo', req),
  extract: (req: ExtractRequest & { sourcePdfPath: string }) => ipcRenderer.invoke('page:extract', req),
  getExtractionJob: (id: string) => ipcRenderer.invoke('page:getExtractionJob', id),
  applySession: (id: string) => ipcRenderer.invoke('page:applySession', id),
  getOverrides: (docId: string, versionId?: string) => ipcRenderer.invoke('page:getOverrides', docId, versionId),
}

const ocrApi = {
  createJob: (req: CreateOcrJobRequest) => ipcRenderer.invoke('ocr:createJob', req),
  getJob: (id: string) => ipcRenderer.invoke('ocr:getJob', id),
  getProgress: (id: string) => ipcRenderer.invoke('ocr:getProgress', id),
  cancel: (id: string) => ipcRenderer.invoke('ocr:cancel', id),
  getResult: (id: string) => ipcRenderer.invoke('ocr:getResult', id),
  getLanguages: () => ipcRenderer.invoke('ocr:getLanguages'),
  mergeText: (jobId: string, docId: string) => ipcRenderer.invoke('ocr:mergeText', jobId, docId),
  pickPdf: () => ipcRenderer.invoke('ocr:pickPdf'),
  onProgress: (cb: (p: unknown) => void) => {
    ipcRenderer.on('ocr:progress', (_e, p) => cb(p))
    return () => ipcRenderer.removeAllListeners('ocr:progress')
  },
}

const pdfApi = {
  split: (req: SplitRequest) => ipcRenderer.invoke('pdf:split', req),
  merge: (req: MergeRequest) => ipcRenderer.invoke('pdf:merge', req),
  stats: (path: string) => ipcRenderer.invoke('pdf:stats', path),
  parseRange: (spec: string, total: number) => ipcRenderer.invoke('pdf:parseRange', spec, total),
  pickFiles: () => ipcRenderer.invoke('pdf:pickFiles'),
  pickSave: (name?: string) => ipcRenderer.invoke('pdf:pickSave', name),
  compress: (inputPath: string, options?: Partial<CompressOptions>) =>
    ipcRenderer.invoke('pdf:compress', inputPath, options),
  compressTo: (inputPath: string, outputPath: string, options?: Partial<CompressOptions>) =>
    ipcRenderer.invoke('pdf:compressTo', inputPath, outputPath, options),
  fileStats: (path: string) => ipcRenderer.invoke('pdf:fileStats', path),
}

const fileApi = {
  read: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  write: (filePath: string, base64: string) => ipcRenderer.invoke('file:write', filePath, base64),
  openDialog: () => ipcRenderer.invoke('file:openDialog'),
  saveDialog: (defaultName?: string) => ipcRenderer.invoke('file:saveDialog', defaultName),
  stat: (filePath: string) => ipcRenderer.invoke('file:stat', filePath),
}

const annApi = {
  upsertWatermark: (config: WatermarkConfig) => ipcRenderer.invoke('ann:upsertWatermark', config),
  getWatermark: (docId: string) => ipcRenderer.invoke('ann:getWatermark', docId),
  removeWatermark: (docId: string) => ipcRenderer.invoke('ann:removeWatermark', docId),
  applyWatermark: (inputPath: string, config: WatermarkConfig) =>
    ipcRenderer.invoke('ann:applyWatermark', inputPath, config),
  add: (
    docId: string, pageNum: number, type: AnnotationRecord['type'],
    bounds: { x: number; y: number; width: number; height: number },
    opts?: { color?: string; content?: string; author?: string; parentId?: string },
  ) => ipcRenderer.invoke('ann:add', docId, pageNum, type, bounds, opts),
  getAll: (docId: string, pageNum?: number) => ipcRenderer.invoke('ann:getAll', docId, pageNum),
  update: (id: string, updates: Partial<Pick<AnnotationRecord, 'content' | 'color' | 'status'>>) =>
    ipcRenderer.invoke('ann:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('ann:delete', id),
  applyRedactions: (inputPath: string, docId: string) =>
    ipcRenderer.invoke('ann:applyRedactions', inputPath, docId),
  flattenAnnotations: (inputPath: string, docId: string) =>
    ipcRenderer.invoke('ann:flattenAnnotations', inputPath, docId),
}

contextBridge.exposeInMainWorld('pageApi', pageApi)
contextBridge.exposeInMainWorld('ocrApi', ocrApi)
contextBridge.exposeInMainWorld('pdfApi', pdfApi)
contextBridge.exposeInMainWorld('annApi', annApi)
contextBridge.exposeInMainWorld('fileApi', fileApi)

export type PageApi = typeof pageApi
export type OcrApi = typeof ocrApi
export type PdfApi = typeof pdfApi
export type AnnApi = typeof annApi
export type FileApi = typeof fileApi
