import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initDb, closeDb } from './services/database'
import { registerPageHandlers } from './ipc/pageHandlers'
import { registerOcrHandlers } from './ipc/ocrHandlers'
import { registerSplitMergeHandlers } from './ipc/splitMergeHandlers'
import { registerCompressHandlers } from './ipc/compressHandlers'
import { registerAnnotationHandlers } from './ipc/annotationHandlers'
import { registerFileHandlers } from './ipc/fileHandlers'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default',
    show: false,
  })

  if (isDev) {
    win.loadURL('http://localhost:5174')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  }

  win.once('ready-to-show', () => win.show())
}

app.whenReady().then(() => {
  initDb()
  registerPageHandlers()
  registerOcrHandlers()
  registerSplitMergeHandlers()
  registerCompressHandlers()
  registerAnnotationHandlers()
  registerFileHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  closeDb()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => closeDb())
