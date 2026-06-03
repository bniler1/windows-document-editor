import { useState, useEffect, useCallback } from 'react'
import type { OcrJobProgress } from '../types'

export function useOcrJob(jobId: string | null): {
  progress: OcrJobProgress | null
  cancel: () => void
} {
  const [progress, setProgress] = useState<OcrJobProgress | null>(null)

  useEffect(() => {
    if (!jobId) {
      setProgress(null)
      return
    }

    let stopped = false

    // Initial fetch
    window.ocrApi.getProgress(jobId).then((p: OcrJobProgress) => {
      if (!stopped) setProgress(p)
    })

    // Listen for push updates from main process
    const cleanup = window.ocrApi.onProgress((p: unknown) => {
      const prog = p as OcrJobProgress
      if (prog.jobId === jobId && !stopped) {
        setProgress(prog)
      }
    })

    return () => {
      stopped = true
      cleanup()
    }
  }, [jobId])

  const cancel = useCallback(() => {
    if (jobId) window.ocrApi.cancel(jobId)
  }, [jobId])

  return { progress, cancel }
}
