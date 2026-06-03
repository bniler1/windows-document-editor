export type RotationDeg = 0 | 90 | 180 | 270

export type SessionStatus = 'active' | 'applied' | 'discarded' | 'stale'
export type ActionType = 'rotate' | 'reorder' | 'delete' | 'restore' | 'extract'
export type ExtractionJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
export type OutputFormat = 'pdf' | 'docx'

export interface PageManagementSession {
  id: string
  documentId: string
  documentVersionId: string | null
  status: SessionStatus
  sourcePageCount: number
  sourceContentHash: string
  createdAt: string
  updatedAt: string
}

export interface SessionPage {
  id: string
  sessionId: string
  originalPageNumber: number
  currentOrderIndex: number
  rotationDeg: RotationDeg
  isDeleted: boolean
  updatedAt: string
}

export interface SessionAction {
  id: string
  sessionId: string
  actionType: ActionType
  payload: Record<string, unknown>
  createdAt: string
  undonAt: string | null
}

export interface ExtractionJob {
  id: string
  sessionId: string
  selectionSpec: string
  includeRotations: boolean
  preserveOrder: boolean
  outputFormat: OutputFormat
  destinationPath: string | null
  status: ExtractionJobStatus
  requestedAt: string
  startedAt: string | null
  finishedAt: string | null
  pageCount: number | null
  resultFilePath: string | null
  errorMessage: string | null
}

export interface DocumentPageOverride {
  id: string
  documentId: string
  documentVersionId: string | null
  pageNumber: number
  orderIndex: number
  rotationDeg: RotationDeg
  isDeleted: boolean
  updatedAt: string
}

// OCR types

export type OcrJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'partial'
export type OcrPageStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'skipped'
export type OcrBlockKind = 'block' | 'paragraph' | 'line' | 'word'
export type OcrArtifactFormat = 'hocr' | 'alto' | 'json' | 'tsv'

export interface OcrJob {
  id: string
  sourcePdfUri: string
  sourcePdfSha256: string
  pageCount: number
  requestedLanguages: string
  ocrEngine: string
  status: OcrJobStatus
  priority: number
  targetDocumentId: string | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface OcrPage {
  id: string
  jobId: string
  pageNumber: number
  widthPx: number | null
  heightPx: number | null
  dpi: number | null
  rotationDeg: number
  status: OcrPageStatus
  languageDetected: string | null
  confidenceAvgPpm: number | null
  textFull: string | null
  imageUri: string | null
  createdAt: string
  updatedAt: string
}

export interface OcrBlock {
  id: string
  pageId: string
  kind: OcrBlockKind
  seq: number
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
  text: string
  lang: string | null
  confidencePpm: number | null
}

export interface OcrArtifact {
  id: string
  pageId: string
  format: OcrArtifactFormat
  content: string
  checksumSha256: string | null
  createdAt: string
}

// IPC channel types

export interface CreateSessionRequest {
  documentId: string
  documentVersionId?: string
  sourcePageCount: number
  sourceContentHash: string
}

export interface RotateRequest {
  sessionId: string
  pages: number[]
  rotationDeg: RotationDeg
}

export interface ReorderRequest {
  sessionId: string
  sourcePages: number[]
  insertAfterPage: number
}

export interface ExtractRequest {
  sessionId: string
  selectionSpec: string
  outputFormat: OutputFormat
  destinationPath: string
  includeRotations?: boolean
  preserveOrder?: boolean
}

export interface DeleteRequest {
  sessionId: string
  pages: number[]
}

export interface UndoRequest {
  sessionId: string
}

export interface CreateOcrJobRequest {
  pdfPath: string
  pageRange?: string
  languages?: string[]
  forceOcr?: boolean
  minConfidence?: number
  password?: string
  priority?: 'normal' | 'low'
  targetDocumentId?: string
}

export interface OcrJobProgress {
  jobId: string
  status: OcrJobStatus
  progress: { pagesTotal: number; pagesProcessed: number }
  perPage: Array<{ page: number; status: string; durationMs?: number; error?: string | null }>
  startedAt: string | null
  updatedAt: string
  error: string | null
}
