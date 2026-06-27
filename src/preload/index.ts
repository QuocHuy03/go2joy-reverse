import { contextBridge, ipcRenderer } from 'electron'
import type {
  DonePayload, ExportPayload, GoogleConfig, GoogleProgress, GoogleResult,
  HotelRow, ProgressPayload, Province, SearchParams,
} from '../shared/types'

/** Đăng ký listener, trả về hàm gỡ đăng ký (tránh trùng listener). */
function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  getProvinces: (): Promise<{ ok: boolean; data?: Province[]; error?: string }> =>
    ipcRenderer.invoke('provinces'),
  startScrape: (params: SearchParams): void => ipcRenderer.send('scrape:start', params),
  stopScrape: (): void => ipcRenderer.send('scrape:stop'),
  exportXlsx: (payload: ExportPayload): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('export:xlsx', payload),
  exportCsv: (payload: ExportPayload): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('export:csv', payload),

  onRow: (cb: (row: HotelRow) => void) => sub('scrape:row', cb),
  onProgress: (cb: (p: ProgressPayload) => void) => sub('scrape:progress', cb),
  onDone: (cb: (p: DonePayload) => void) => sub('scrape:done', cb),
  onError: (cb: (msg: string) => void) => sub('scrape:error', cb),

  // Google Sheets / Drive
  pickJson: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke('dialog:pickJson'),
  googleLogin: (clientPath: string): Promise<{ ok: boolean; email?: string; error?: string }> =>
    ipcRenderer.invoke('google:login', clientPath),
  oauthStatus: (clientPath: string): Promise<{ loggedIn: boolean; email: string }> =>
    ipcRenderer.invoke('google:oauthStatus', clientPath),
  // lưu/đọc cấu hình (SQLite local)
  loadSettings: (section: string): Promise<any> => ipcRenderer.invoke('settings:load', section),
  saveSettings: (section: string, data: unknown): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:save', { section, data }),

  runGoogle: (cfg: GoogleConfig): void => ipcRenderer.send('google:run', cfg),
  onGoogleProgress: (cb: (p: GoogleProgress) => void) => sub('google:progress', cb),
  onGoogleDone: (cb: (r: GoogleResult) => void) => sub('google:done', cb),
  onGoogleError: (cb: (msg: string) => void) => sub('google:error', cb),
}

contextBridge.exposeInMainWorld('go2joy', api)

export type Go2JoyApi = typeof api
