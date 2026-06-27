// Kiểu dữ liệu dùng chung giữa main / preload / renderer.

export interface Province {
  sn: number
  name: string
  totalHotel: number
}

export type BookingType = 1 | 2 | 3

export interface SearchParams {
  provinceSn: number
  provinceName: string
  bookingTypes: BookingType[]
  checkinDate: string
  startTime: string
  endTime: string
  durationHours: number
  minPrice: number
  maxPrice: number
  sort: number
  maxPages: number
  fetchDetail: boolean
  proxyMode: 'none' | 'manual' | 'tmproxy'
  proxyUrl: string
  proxyApiKey: string
  fakeDevice: boolean
}

/** Một dòng kết quả khớp cấu trúc cột Google Sheet. */
export type HotelRow = Record<string, string>

export interface ProgressPayload {
  label: string
  fetched: number
  total: number
}

export interface DonePayload {
  count: number
  stopped: boolean
}

export interface ExportPayload {
  rows: HotelRow[]
  defaultName: string
}

export type WriteMode = 'append' | 'overwrite'

export interface GoogleConfig {
  // Sheet và Drive xác thực ĐỘC LẬP:
  sheetCredPath: string    // Sheet  -> service account JSON
  oauthClientPath: string  // Drive  -> OAuth client (để trống = client nhúng sẵn)
  sheetUrl: string
  sheetTab: string
  doSheet: boolean
  doDrive: boolean
  writeMode: WriteMode
  driveParentId: string
  masterFolderName: string
  rows: HotelRow[]
}

export interface GoogleProgress {
  stage: string
  done: number
  total: number
}

export interface GoogleResult {
  ok: boolean
  error?: string
  sheetUrl?: string
  masterFolderUrl?: string
  uploaded?: number
  failed?: number
  skipped?: number
  firstError?: string
  folders?: number
}
