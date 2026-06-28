// Tích hợp Google Sheets + Drive bằng service account.
import { readFileSync } from 'fs'
import { Readable } from 'stream'
import { google, type sheets_v4 } from 'googleapis'
import { JWT } from 'google-auth-library'
import { getOAuthClient } from './oauth'
import { SHEET_COLUMNS, BOOKING_COLORS } from '../shared/constants'
import type { GoogleConfig, HotelRow } from '../shared/types'

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
]

function authFrom(credPath: string): JWT {
  const key = JSON.parse(readFileSync(credPath, 'utf8'))
  if (!key.client_email || !key.private_key) {
    throw new Error('File JSON không phải service account (thiếu client_email/private_key).')
  }
  return new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: SCOPES })
}

/** Xác thực ĐỘC LẬP: Sheet = service account, Drive = OAuth (bắt buộc, vì SA không có quota). */
function buildAuth(cfg: GoogleConfig, which: 'drive' | 'sheet') {
  if (which === 'drive') return getOAuthClient(cfg.oauthClientPath)
  if (!cfg.sheetCredPath) throw new Error('Chưa chọn file service account cho Sheet.')
  return authFrom(cfg.sheetCredPath)
}

/** Trích thông điệp lỗi dễ đọc từ lỗi googleapis. */
function gErr(e: any): string {
  return (
    e?.response?.data?.error?.message ||
    e?.errors?.[0]?.message ||
    e?.message ||
    String(e)
  )
}

export function parseSheetId(urlOrId: string): string {
  const m = String(urlOrId).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  return m ? m[1] : String(urlOrId).trim()
}

function hexToRgb(hex: string) {
  const n = parseInt(hex, 16)
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 }
}

function sanitizeFolderName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'unnamed'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Thử lại khi dính rate limit / lỗi tạm thời, backoff tăng dần. */
async function withRetry<T>(fn: () => Promise<T>, retries = 6): Promise<T> {
  let delay = 600
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      const code = e?.code || e?.response?.status
      const reason = e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || ''
      const retriable =
        code === 429 || code === 500 || code === 502 || code === 503 ||
        reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'backendError'
      if (!retriable || attempt >= retries) throw e
      await sleep(delay + Math.floor(Math.random() * 400)) // jitter
      delay = Math.min(delay * 2, 16000)
    }
  }
}

/** Gọi 1 API (có retry); nếu lỗi thì ném kèm nhãn để dễ debug. */
async function call<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withRetry(fn)
  } catch (e) {
    throw new Error(`Sheet [${label}]: ${gErr(e)}`)
  }
}

/** Chạy worker trên danh sách với số luồng đồng thời cố định. */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let i = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { await worker(items[idx]) } catch { /* bỏ qua item lỗi */ }
    }
  })
  await Promise.all(runners)
}

// ---------------------------------------------------------------- Drive

async function findOrCreateFolder(drive: any, name: string, parentId?: string): Promise<string> {
  const safe = name.replace(/'/g, "\\'")
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    `name='${safe}'`,
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(' and ')

  const res = await withRetry(() =>
    drive.files.list({ q, fields: 'files(id,name)', pageSize: 1, supportsAllDrives: true }))
  if (res.data.files && res.data.files.length) return res.data.files[0].id!

  const created = await withRetry(() =>
    drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      },
      fields: 'id',
      supportsAllDrives: true,
    }))
  return created.data.id!
}

/** Liệt kê tất cả folder con (name -> id) của 1 folder cha, 1 lần (có phân trang). */
async function listChildFolders(drive: any, parentId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  let pageToken: string | undefined
  do {
    const res: any = await withRetry(() =>
      drive.files.list({
        q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'nextPageToken, files(id,name)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }))
    for (const f of res.data.files || []) if (f.name && f.id) map.set(f.name, f.id)
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)
  return map
}

/** Tạo folder (không tìm trước — dùng khi đã biết chưa tồn tại). */
async function createFolder(drive: any, name: string, parentId: string): Promise<string> {
  const created = await withRetry(() =>
    drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
      supportsAllDrives: true,
    }))
  return created.data.id!
}

async function makeAnyoneReader(drive: any, fileId: string) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: 'reader', type: 'anyone' },
      supportsAllDrives: true,
    })
  } catch { /* có thể bị chặn bởi policy domain; bỏ qua */ }
}

function folderLink(id: string): string {
  return `https://drive.google.com/drive/folders/${id}`
}

/** Liệt kê tên file đã có trong 1 folder (để bỏ qua ảnh đã up). */
async function listFileNames(drive: any, folderId: string): Promise<Set<string>> {
  const names = new Set<string>()
  let pageToken: string | undefined
  do {
    const res: any = await withRetry(() =>
      drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        fields: 'nextPageToken, files(name)',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }))
    for (const f of res.data.files || []) if (f.name) names.add(f.name)
    pageToken = res.data.nextPageToken || undefined
  } while (pageToken)
  return names
}

/** Lỗi không thể khắc phục bằng retry (quota SA / thiếu quyền folder). */
function isFatalDrive(e: any): boolean {
  const reason = e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || ''
  const msg = gErr(e).toLowerCase()
  return (
    reason === 'storageQuotaExceeded' ||
    reason === 'insufficientFilePermissions' ||
    reason === 'insufficientPermissions' ||
    msg.includes('storage quota') ||
    msg.includes('do not have storage') ||
    msg.includes('service accounts do not have')
  )
}

function imageName(url: string, idx: number): string {
  const ext = (url.split('.').pop() || 'jpg').split('?')[0].slice(0, 5)
  return `${String(idx).padStart(3, '0')}.${ext}`
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  let lastErr: any
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`tải ảnh ${res.status}`)
      return res
    } catch (e) {
      lastErr = e
      if (i < retries - 1) await sleep(800 * (i + 1))
    }
  }
  throw lastErr
}

async function uploadImage(drive: any, folderId: string, url: string, name: string) {
  const res = await fetchWithRetry(url)
  const buf = Buffer.from(await res.arrayBuffer())
  const mime = res.headers.get('content-type') || 'image/jpeg'
  await withRetry(() =>
    drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType: mime, body: Readable.from(buf) },
      fields: 'id',
      supportsAllDrives: true,
    }))
}

const UPLOAD_CONCURRENCY = 6
const FOLDER_CONCURRENCY = 10

// ---------------------------------------------------------------- Sheets

async function getSheetTabId(sheets: sheets_v4.Sheets, spreadsheetId: string, tabTitle: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const found = meta.data.sheets?.find((s) => s.properties?.title === tabTitle)
  if (found?.properties?.sheetId != null) return found.properties.sheetId
  // tạo tab nếu chưa có
  const add = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] },
  })
  return add.data.replies![0].addSheet!.properties!.sheetId!
}

const SHEET_BATCH_ROWS = 500   // số dòng mỗi lần append
const SHEET_BATCH_REQS = 100   // số request mỗi lần batchUpdate

async function writeSheet(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  rows: HotelRow[],
  mode: 'append' | 'overwrite',
  onProgress: (stage: string, done: number, total: number) => void,
) {
  const header = [...SHEET_COLUMNS]
  const dataRows = rows.map((r) => header.map((c) => r[c] ?? ''))

  const tabId = await call('lấy tab', () => getSheetTabId(sheets, spreadsheetId, tabTitle))

  // số dòng đang có (đếm theo cột A)
  const existing = await call('đọc dòng hiện có', () =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabTitle}!A1:A` }))
  const existingRows = existing.data.values?.length || 0

  let firstDataRow0 = -1
  let wroteHeader = false

  if (mode === 'overwrite' || existingRows === 0) {
    if (mode === 'overwrite' && existingRows > 0) {
      await call('xoá dữ liệu cũ', () =>
        sheets.spreadsheets.values.clear({ spreadsheetId, range: tabTitle }))
    }
    await call('ghi header', () =>
      sheets.spreadsheets.values.update({
        spreadsheetId, range: `${tabTitle}!A1`, valueInputOption: 'RAW',
        requestBody: { values: [header] },
      }))
    wroteHeader = true
  }

  // append dữ liệu THEO BATCH (sau header / sau dữ liệu cũ)
  for (let i = 0; i < dataRows.length; i += SHEET_BATCH_ROWS) {
    const chunk = dataRows.slice(i, i + SHEET_BATCH_ROWS)
    const res = await call(`ghi dòng ${i + 1}-${i + chunk.length}`, () =>
      sheets.spreadsheets.values.append({
        spreadsheetId, range: `${tabTitle}!A1`, valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS', requestBody: { values: chunk },
      }))
    if (firstDataRow0 < 0) {
      const m = (res.data.updates?.updatedRange || '').match(/![A-Z]+(\d+):/)
      firstDataRow0 = m ? parseInt(m[1], 10) - 1 : existingRows
    }
    onProgress('Sheets: ghi dòng', Math.min(i + chunk.length, dataRows.length), dataRows.length)
  }
  if (firstDataRow0 < 0) firstDataRow0 = wroteHeader ? 1 : existingRows

  // ----- định dạng: gộp các dòng cùng màu liên tiếp thành 1 range -----
  const requests: sheets_v4.Schema$Request[] = []
  if (wroteHeader) {
    requests.push({
      repeatCell: {
        range: { sheetId: tabId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { backgroundColor: hexToRgb('00E000'), textFormat: { bold: true } } },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    })
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: tabId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    })
  }
  let i = 0
  while (i < rows.length) {
    const hex = BOOKING_COLORS[rows[i]['loại thuê']]
    if (!hex) { i++; continue }
    let j = i + 1
    while (j < rows.length && BOOKING_COLORS[rows[j]['loại thuê']] === hex) j++
    requests.push({
      repeatCell: {
        range: {
          sheetId: tabId,
          startRowIndex: firstDataRow0 + i, endRowIndex: firstDataRow0 + j,
          startColumnIndex: 1, endColumnIndex: 2,
        },
        cell: { userEnteredFormat: { backgroundColor: hexToRgb(hex) } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
    i = j
  }

  // batchUpdate THEO BATCH (tránh 1 request quá lớn)
  for (let k = 0; k < requests.length; k += SHEET_BATCH_REQS) {
    const chunk = requests.slice(k, k + SHEET_BATCH_REQS)
    await call(`định dạng ${k + 1}-${k + chunk.length}`, () =>
      sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: chunk } }))
  }
}

// ---------------------------------------------------------------- Orchestrator

export async function runGoogle(
  cfg: GoogleConfig,
  onProgress: (stage: string, done: number, total: number) => void,
) {
  const rows = cfg.rows.map((r) => ({ ...r })) // copy để chỉnh ảnh link tổng
  let uploaded = 0
  let failed = 0
  let skipped = 0
  let firstError = ''
  let folders = 0
  let masterUrl: string | undefined

  // ----- Drive: upload ảnh, tạo folder, gắn link vào cột G -----
  if (cfg.doDrive) {
    const driveAuth = buildAuth(cfg, 'drive')
    const drive = google.drive({ version: 'v3', auth: driveAuth as any })

    const masterId = await findOrCreateFolder(drive, cfg.masterFolderName, cfg.driveParentId || undefined)
    await makeAnyoneReader(drive, masterId)
    masterUrl = folderLink(masterId)

    // ===== Cấu trúc LỒNG: master / [folder khách sạn] / [folder phòng con] =====
    // gom theo KHÁCH SẠN (tòa chính)
    const hotelGroups = new Map<string, HotelRow[]>()
    for (const r of rows) {
      const key = r['__hotelSn'] || r['tên ks'] || '?'
      if (!hotelGroups.has(key)) hotelGroups.set(key, [])
      hotelGroups.get(key)!.push(r)
    }
    const hotels = [...hotelGroups.values()].map((hrows) => ({
      name: sanitizeFolderName(hrows[0]['tên ks'] || 'KS'),
      rows: hrows,
      hotelImages: (hrows[0]['__hotelImages'] || '').split('\n').map((s) => s.trim()).filter(Boolean),
      folderId: '',
      isNew: false,
    }))

    // folder khách sạn đã có dưới master (lấy 1 lần)
    const masterChildren = await listChildFolders(drive, masterId)

    // 1) tạo folder KHÁCH SẠN (song song)
    let hi = 0
    onProgress('Drive: tạo folder KS', 0, hotels.length)
    await pool(hotels, FOLDER_CONCURRENCY, async (h) => {
      const found = masterChildren.get(h.name)
      if (found) h.folderId = found
      else { h.folderId = await createFolder(drive, h.name, masterId); h.isNew = true }
      folders += 1
      hi += 1
      if (hi % 5 === 0 || hi === hotels.length) onProgress('Drive: tạo folder KS', hi, hotels.length)
    })

    // 2) mỗi PHÒNG -> 1 folder con (chỉ ảnh phòng), cột G = link folder PHÒNG đó
    const tasks: { folderId: string; url: string; name: string }[] = []
    let pi = 0
    onProgress('Drive: chuẩn bị ảnh', 0, hotels.length)
    await pool(hotels, FOLDER_CONCURRENCY, async (h) => {
      const roomFolders = h.isNew ? new Map<string, string>() : await listChildFolders(drive, h.folderId)

      // gom ảnh theo tên phòng (bỏ qua phòng KHÔNG có tên -> tránh folder "unnamed")
      const rooms = new Map<string, string[]>()
      for (const r of h.rows) {
        const raw = (r['danh sách phòng'] || '').trim()
        if (!raw) continue
        const rn = sanitizeFolderName(raw)
        if (!rooms.has(rn)) {
          rooms.set(rn, (r['__roomImages'] || '').split('\n').map((s) => s.trim()).filter(Boolean))
        }
      }

      // tạo/reuse folder phòng + đẩy ảnh; nhớ link folng phòng
      const roomLink = new Map<string, string>()
      for (const [roomName, imgs] of rooms) {
        const existedId = roomFolders.get(roomName)
        let roomId = existedId
        let roomExisting = new Set<string>()
        if (!roomId) { roomId = await createFolder(drive, roomName, h.folderId); folders += 1 }
        else roomExisting = await listFileNames(drive, roomId)
        roomLink.set(roomName, folderLink(roomId))
        imgs.forEach((u, k) => {
          const name = imageName(u, k + 1)
          if (roomExisting.has(name)) { skipped += 1; return }
          tasks.push({ folderId: roomId!, url: u, name })
        })
      }

      // cột G của mỗi dòng = link folder PHÒNG của dòng đó
      for (const r of h.rows) {
        const rn = sanitizeFolderName(r['danh sách phòng'] || '')
        const link = roomLink.get(rn)
        if (link) r['ảnh link tổng'] = link
      }

      // dòng không có tên phòng -> upload ảnh thẳng vào folder KS, gán link KS
      const noRoomRows = h.rows.filter((r) => !(r['danh sách phòng'] || '').trim())
      if (noRoomRows.length > 0) {
        const imgStr = noRoomRows[0]['__hotelImages'] || noRoomRows[0]['__roomImages'] || ''
        const imgs = imgStr.split('\n').map((s) => s.trim()).filter(Boolean)
        if (imgs.length > 0) {
          const hotelExisting = h.isNew ? new Set<string>() : await listFileNames(drive, h.folderId)
          imgs.forEach((u, k) => {
            const name = imageName(u, k + 1)
            if (hotelExisting.has(name)) { skipped += 1; return }
            tasks.push({ folderId: h.folderId, url: u, name })
          })
        }
        const hLink = folderLink(h.folderId)
        for (const r of noRoomRows) r['ảnh link tổng'] = hLink
      }

      pi += 1
      if (pi % 5 === 0 || pi === hotels.length) onProgress('Drive: chuẩn bị ảnh', pi, hotels.length)
    })

    // 3) upload SONG SONG; dừng sớm nếu gặp lỗi nghiêm trọng (quota/quyền)
    const total = tasks.length
    let fatal = ''
    await pool(tasks, UPLOAD_CONCURRENCY, async (t) => {
      if (fatal) return
      // thử lại tối đa 3 lần (lỗi mạng tạm thời như "terminated"); fatal thì dừng luôn
      let lastErr: any
      let ok = false
      for (let attempt = 0; attempt < 3 && !fatal; attempt++) {
        try {
          await uploadImage(drive, t.folderId, t.url, t.name)
          ok = true
          break
        } catch (e: any) {
          lastErr = e
          if (isFatalDrive(e)) { fatal = gErr(e); break }
          await sleep(500 * (attempt + 1))
        }
      }
      if (ok) {
        uploaded += 1
      } else {
        failed += 1
        const msg = gErr(lastErr)
        if (!firstError) firstError = msg
      }
      const seen = uploaded + failed
      if (seen % 5 === 0 || seen === total) {
        onProgress(`Drive: upload ảnh${failed ? ` (lỗi ${failed})` : ''}`, seen, total)
      }
    })
    if (skipped) onProgress(`Drive: bỏ qua ${skipped} ảnh đã có`, uploaded + failed, total)
    onProgress(`Drive: upload ảnh${failed ? ` (lỗi ${failed})` : ''}`, uploaded + failed, total)
  }

  // ----- Sheets: ghi bảng -----
  let outSheetUrl: string | undefined
  if (cfg.doSheet) {
    const sheetAuth = buildAuth(cfg, 'sheet')
    const sheets = google.sheets({ version: 'v4', auth: sheetAuth as any })
    const spreadsheetId = parseSheetId(cfg.sheetUrl)
    onProgress('Sheets: đang ghi', 0, 1)
    await writeSheet(sheets, spreadsheetId, cfg.sheetTab || 'go2joy', rows, cfg.writeMode || 'append', onProgress)
    onProgress('Sheets: đang ghi', 1, 1)
    outSheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  }

  return { ok: true, uploaded, failed, skipped, firstError, folders, masterFolderUrl: masterUrl, sheetUrl: outSheetUrl }
}
