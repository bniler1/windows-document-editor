/**
 * Blob store for extracted PDF assets (images, thumbnails, artifacts).
 * Stores files on disk under userData/blobs/{sha256[0..1]}/{sha256}.ext
 * Validates integrity via SHA-256.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { app } from 'electron'

function getBlobRoot(): string {
  const p = path.join(app.getPath('userData'), 'blobs')
  fs.mkdirSync(p, { recursive: true })
  return p
}

export function storeBlobFromBuffer(data: Buffer, ext = 'bin'): { blobPath: string; sha256: string } {
  const sha256 = crypto.createHash('sha256').update(data).digest('hex')
  const dir = path.join(getBlobRoot(), sha256.slice(0, 2))
  fs.mkdirSync(dir, { recursive: true })
  const blobPath = path.join(dir, `${sha256}.${ext}`)
  if (!fs.existsSync(blobPath)) fs.writeFileSync(blobPath, data)
  return { blobPath, sha256 }
}

export function storeBlobFromBase64(base64: string, ext = 'bin'): { blobPath: string; sha256: string } {
  return storeBlobFromBuffer(Buffer.from(base64, 'base64'), ext)
}

export function readBlob(blobPath: string): Buffer {
  return fs.readFileSync(blobPath)
}

export function verifyBlob(blobPath: string, expectedSha256: string): boolean {
  try {
    const data = fs.readFileSync(blobPath)
    const actual = crypto.createHash('sha256').update(data).digest('hex')
    return actual === expectedSha256
  } catch { return false }
}

export function deleteBlob(blobPath: string): void {
  try { fs.unlinkSync(blobPath) } catch { /* non-critical */ }
}

export function getBlobAsBase64(blobPath: string): string {
  return fs.readFileSync(blobPath).toString('base64')
}
