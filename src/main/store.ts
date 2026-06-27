// Lưu cấu hình app vào SQLite local (sql.js / WASM — không cần build native).
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let db: any = null
let dbPath = ''

export async function initStore(): Promise<void> {
  try {
    const initSqlJs = require('sql.js')
    const distDir = dirname(require.resolve('sql.js'))
    const SQL = await initSqlJs({ locateFile: (f: string) => join(distDir, f) })

    dbPath = join(app.getPath('userData'), 'go2joy-settings.sqlite')
    db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database()
    db.run('CREATE TABLE IF NOT EXISTS settings (section TEXT PRIMARY KEY, json TEXT)')
    persist()
  } catch (e) {
    console.error('[store] init lỗi, settings sẽ không lưu được:', e)
    db = null
  }
}

function persist(): void {
  if (!db || !dbPath) return
  try {
    writeFileSync(dbPath, Buffer.from(db.export()))
  } catch (e) {
    console.error('[store] ghi file lỗi:', e)
  }
}

export function getSection(section: string): any | null {
  if (!db) return null
  const res = db.exec('SELECT json FROM settings WHERE section = ?', [section])
  if (!res.length || !res[0].values.length) return null
  try {
    return JSON.parse(res[0].values[0][0] as string)
  } catch {
    return null
  }
}

export function setSection(section: string, data: unknown): void {
  if (!db) return
  db.run(
    'INSERT INTO settings (section, json) VALUES (?, ?) ' +
      'ON CONFLICT(section) DO UPDATE SET json = excluded.json',
    [section, JSON.stringify(data)],
  )
  persist()
}
