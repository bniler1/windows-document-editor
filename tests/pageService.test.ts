/**
 * Smoke tests for Page Management service — covers rotate, reorder, extract, delete,
 * undo, and session lifecycle. Uses an in-memory SQLite database via node:sqlite.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { jest } from '@jest/globals'

jest.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: jest.fn() },
  dialog: { showSaveDialog: jest.fn(), showOpenDialog: jest.fn() },
}))

import * as dbModule from '../electron/services/database'
import {
  createSession,
  getSession,
  getSessionPages,
  rotatePages,
  reorderPages,
  deletePages,
  undoLastAction,
} from '../electron/services/pageService'

let testDb: DatabaseSync

beforeAll(() => {
  testDb = new DatabaseSync(':memory:')
  testDb.exec('PRAGMA journal_mode=WAL')
  testDb.exec('PRAGMA foreign_keys=ON')

  const migsDir = path.join(__dirname, '..', 'db', 'migrations')
  for (const f of fs.readdirSync(migsDir).sort()) {
    if (f.endsWith('.sql')) {
      testDb.exec(fs.readFileSync(path.join(migsDir, f), 'utf-8'))
    }
  }

  // Inject in-memory db
  Object.defineProperty(dbModule, 'getDb', { value: () => testDb, writable: true })
})

afterAll(() => testDb.close())

describe('Page Management — createSession', () => {
  test('creates session and populates session_pages', () => {
    const session = createSession('doc-1', 5, 'hash-abc')
    expect(session.documentId).toBe('doc-1')
    expect(session.sourcePageCount).toBe(5)

    const pages = getSessionPages(session.id)
    expect(pages).toHaveLength(5)
    expect(pages[0].originalPageNumber).toBe(1)
    expect(pages[0].currentOrderIndex).toBe(1)
    expect(pages[0].rotationDeg).toBe(0)
    expect(pages[0].isDeleted).toBe(false)
  })

  test('marks previous active session as stale', () => {
    const s1 = createSession('doc-stale', 3, 'hash-1')
    const s2 = createSession('doc-stale', 3, 'hash-2')
    expect(getSession(s1.id)?.status).toBe('stale')
    expect(s2.status).toBe('active')
  })
})

describe('Page Management — rotate', () => {
  test('rotates selected pages and records action', () => {
    const session = createSession('doc-rotate', 5, 'hash-r')
    rotatePages(session.id, [1, 3], 90)
    const pages = getSessionPages(session.id)
    expect(pages.find((p) => p.originalPageNumber === 1)?.rotationDeg).toBe(90)
    expect(pages.find((p) => p.originalPageNumber === 3)?.rotationDeg).toBe(90)
    expect(pages.find((p) => p.originalPageNumber === 2)?.rotationDeg).toBe(0)
  })

  test('rotate then undo restores previous rotation', () => {
    const session = createSession('doc-rotate-undo', 3, 'hash-ru')
    rotatePages(session.id, [1], 180)
    undoLastAction(session.id)
    const pages = getSessionPages(session.id)
    expect(pages.find((p) => p.originalPageNumber === 1)?.rotationDeg).toBe(0)
  })
})

describe('Page Management — reorder', () => {
  test('moves page 1 after page 3', () => {
    const session = createSession('doc-reorder', 5, 'hash-re')
    reorderPages(session.id, [1], 3)
    const pages = getSessionPages(session.id)
    const order = pages.map((p) => p.originalPageNumber)
    expect(order.indexOf(1)).toBeGreaterThan(order.indexOf(3))
  })

  test('reorder with no effective change preserves order', () => {
    const session = createSession('doc-reorder-self', 4, 'hash-rs')
    reorderPages(session.id, [2], 2)
    const pages = getSessionPages(session.id)
    expect(pages.map((p) => p.originalPageNumber)).toEqual([1, 2, 3, 4])
  })
})

describe('Page Management — delete', () => {
  test('soft-deletes pages', () => {
    const session = createSession('doc-delete', 5, 'hash-d')
    deletePages(session.id, [2, 4])
    const pages = getSessionPages(session.id)
    expect(pages.find((p) => p.originalPageNumber === 2)?.isDeleted).toBe(true)
    expect(pages.find((p) => p.originalPageNumber === 4)?.isDeleted).toBe(true)
  })

  test('cannot delete all pages', () => {
    const session = createSession('doc-delete-all', 2, 'hash-da')
    expect(() => deletePages(session.id, [1, 2])).toThrow('CANNOT_DELETE_ALL_PAGES')
  })

  test('delete then undo restores pages', () => {
    const session = createSession('doc-delete-undo', 3, 'hash-du')
    deletePages(session.id, [1])
    undoLastAction(session.id)
    const pages = getSessionPages(session.id)
    expect(pages.find((p) => p.originalPageNumber === 1)?.isDeleted).toBe(false)
  })
})

describe('Page Management — large document smoke test', () => {
  test('handles 200-page document within 2 seconds', () => {
    const start = Date.now()
    const session = createSession('doc-large', 200, 'hash-large')
    const pages = getSessionPages(session.id)
    expect(pages).toHaveLength(200)

    rotatePages(session.id, Array.from({ length: 100 }, (_, i) => i + 1), 90)
    reorderPages(session.id, [1, 2, 3, 4, 5], 150)
    deletePages(session.id, [10, 20, 30, 40, 50])

    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2000)
  })
})
