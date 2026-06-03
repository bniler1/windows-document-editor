import type { PageApi, OcrApi, PdfApi, AnnApi, FileApi } from '../electron/preload'

declare global {
  interface Window {
    pageApi: PageApi
    ocrApi: OcrApi
    pdfApi: PdfApi
    annApi: AnnApi
    fileApi: FileApi
  }
}
