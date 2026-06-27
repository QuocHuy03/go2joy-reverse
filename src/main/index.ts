import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import ExcelJS from 'exceljs'
import * as api from './api'
import { runGoogle } from './google'
import { loginOAuth, getOAuthStatus } from './oauth'
import { acquireProxy, rotateProxy } from './tmproxy'
import { initStore, getSection, setSection } from './store'
import { BOOKING_TYPES, BOOKING_COLORS, SHEET_COLUMNS } from '../shared/constants'
import type { ExportPayload, GoogleConfig, SearchParams } from '../shared/types'

let win: BrowserWindow | null = null
let stopFlag = false

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#0f1117',
    title: 'Go2Joy Hotel Scraper',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await initStore()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

ipcMain.handle('settings:load', (_e, section: string) => getSection(section))
ipcMain.handle('settings:save', (_e, { section, data }: { section: string; data: unknown }) => {
  setSection(section, data)
  return { ok: true }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------- IPC

ipcMain.handle('provinces', async () => {
  try {
    return { ok: true, data: await api.getProvinces() }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
})

ipcMain.on('scrape:stop', () => {
  stopFlag = true
})

ipcMain.on('scrape:start', async (evt, params: SearchParams) => {
  stopFlag = false
  const send = (ch: string, payload?: unknown) => evt.sender.send(ch, payload)
  let count = 0
  try {
    // ----- fake device (device-encode + user-agent) -----
    api.setFakeDevice(!!params.fakeDevice)

    // ----- cấu hình proxy -----
    api.setRotateHandler(null)
    if (params.proxyMode === 'manual' && params.proxyUrl.trim()) {
      api.setProxy(params.proxyUrl.trim())
    } else if (params.proxyMode === 'tmproxy' && params.proxyApiKey.trim()) {
      const url = await acquireProxy(params.proxyApiKey.trim())
      api.setProxy(url)
      api.setRotateHandler(async () => {
        const nu = await rotateProxy(params.proxyApiKey.trim())
        api.setProxy(nu)
        if (params.fakeDevice) api.randomizeDevice() // limit -> đổi cả IP lẫn device
      })
    } else {
      api.setProxy(undefined)
      // không proxy nhưng vẫn đổi device khi bị limit (nếu bật)
      if (params.fakeDevice) api.setRotateHandler(async () => { api.randomizeDevice() })
    }

    for (const bt of params.bookingTypes) {
      if (stopFlag) break
      const label = BOOKING_TYPES[bt].label
      const combo = BOOKING_TYPES[bt].combo(params.durationHours)
      await api.iterHotelList(
        {
          provinceSn: params.provinceSn,
          bookingType: bt,
          checkinDate: params.checkinDate,
          endDate: params.checkinDate,
          startTime: params.startTime,
          endTime: params.endTime,
          minPrice: params.minPrice,
          maxPrice: params.maxPrice,
          sort: params.sort,
          limit: 100,
        },
        {
          delay: 300,
          maxPages: params.maxPages,
          shouldStop: () => stopFlag,
          onProgress: (fetched, total) => send('scrape:progress', { label, fetched, total }),
          onHotel: async (hotel) => {
            if (stopFlag) return
            const ctx = { provinceName: params.provinceName, bookingType: bt, combo }

            // gọi song song để giảm thời gian chờ
            const [detail, rooms] = await Promise.all([
              params.fetchDetail ? api.getHotelDetail(hotel.sn) : Promise.resolve({}),
              api.getRoomTypeList(hotel.sn, bt, {
                startDate: params.checkinDate,
                startTime: params.startTime,
                endDate: params.checkinDate,
                endTime: params.endTime,
              }),
            ])

            if (rooms.length) {
              for (const room of rooms) {
                if (stopFlag) return
                count += 1
                send('scrape:row', api.mapRoomRow(hotel, detail, room, ctx))
              }
            } else {
              // không có phòng -> 1 dòng cấp khách sạn (dự phòng)
              count += 1
              send('scrape:row', api.mapRow(hotel, detail, ctx))
            }
          },
        },
      )
    }
    send('scrape:done', { count, stopped: stopFlag })
  } catch (e: any) {
    send('scrape:error', String(e?.message || e))
  }
})

ipcMain.handle('google:login', async (_e, clientPath: string) => {
  try {
    return await loginOAuth(clientPath)
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
})

ipcMain.handle('google:oauthStatus', (_e, clientPath: string) => getOAuthStatus(clientPath))

ipcMain.handle('dialog:pickJson', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
    title: 'Chọn file service account JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePaths.length) return { ok: false }
  return { ok: true, path: filePaths[0] }
})

ipcMain.on('google:run', async (evt, cfg: GoogleConfig) => {
  const send = (ch: string, payload?: unknown) => evt.sender.send(ch, payload)
  try {
    const res = await runGoogle(cfg, (stage, done, total) =>
      send('google:progress', { stage, done, total }),
    )
    send('google:done', res)
  } catch (e: any) {
    send('google:error', String(e?.message || e))
  }
})

ipcMain.handle('export:csv', async (_e, { rows, defaultName }: ExportPayload) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title: 'Lưu CSV',
    defaultPath: defaultName,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (canceled || !filePath) return { ok: false }
  const cols = SHEET_COLUMNS
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [cols.join(',')]
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','))
  writeFileSync(filePath, '﻿' + lines.join('\r\n'), 'utf8')
  return { ok: true, path: filePath }
})

ipcMain.handle('export:xlsx', async (_e, { rows, defaultName }: ExportPayload) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title: 'Lưu Excel',
    defaultPath: defaultName,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (canceled || !filePath) return { ok: false }

  const cols = SHEET_COLUMNS
  const widths = [10, 12, 24, 32, 26, 24, 30, 12, 10, 22, 40, 28, 14, 24]
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('hotels')
  ws.columns = cols.map((c, i) => ({ header: c, key: c, width: widths[i] }))

  ws.getRow(1).eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00E000' } }
    cell.font = { bold: true }
  })

  for (const r of rows) {
    const row = ws.addRow(cols.map((c) => r[c] ?? ''))
    row.alignment = { wrapText: true, vertical: 'top' }
    const hex = BOOKING_COLORS[r['loại thuê']]
    if (hex) {
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex } }
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  await wb.xlsx.writeFile(filePath)
  return { ok: true, path: filePath }
})
