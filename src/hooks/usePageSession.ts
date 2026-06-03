import { useState, useEffect, useCallback } from 'react'
import type { PageManagementSession, SessionPage } from '../types'

export function usePageSession(
  documentId: string | null,
  sourcePageCount: number,
  sourceContentHash: string,
) {
  const [session, setSession] = useState<PageManagementSession | null>(null)
  const [pages, setPages] = useState<SessionPage[]>([])
  const [loading, setLoading] = useState(false)

  const initSession = useCallback(async () => {
    if (!documentId) return
    setLoading(true)
    try {
      const s = await window.pageApi.createSession({
        documentId,
        sourcePageCount,
        sourceContentHash,
      })
      setSession(s)
      const p = await window.pageApi.getPages(s.id)
      setPages(p)
    } finally {
      setLoading(false)
    }
  }, [documentId, sourcePageCount, sourceContentHash])

  const refreshPages = useCallback(async () => {
    if (!session) return
    const p = await window.pageApi.getPages(session.id)
    setPages(p)
  }, [session])

  useEffect(() => {
    initSession()
  }, [initSession])

  return { session, pages, loading, refreshPages, initSession }
}
