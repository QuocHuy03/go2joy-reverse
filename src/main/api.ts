// Client API Go2Joy (chạy ở main process).
import { randomUUID } from 'node:crypto'
import { BOOKING_TYPES } from '../shared/constants'
import type { BookingType, HotelRow, Province } from '../shared/types'

const API_BASE = 'https://api.go2joy.vn/api/v1'
const IMAGE_BASE = 'https://s3.go2joy.vn'
const IMAGE_WIDTH = '1000w'

// ----- Fake device: đổi device-encode (UUID) + user-agent để tránh bị nhận diện -----
const CHROME_VERSIONS = ['147.0.0.0', '148.0.0.0', '149.0.0.0', '150.0.0.0', '151.0.0.0']
const PLATFORMS = [
  'Windows NT 10.0; Win64; x64',
  'Windows NT 11.0; Win64; x64',
  'Macintosh; Intel Mac OS X 10_15_7',
]
const rnd = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]

let _deviceEncode = '466c1123-a094-47bd-945e-27a560a93177'
let _userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
let _fakeOn = false

/** Sinh device-encode + user-agent mới (ngẫu nhiên). */
export function randomizeDevice(): void {
  _deviceEncode = randomUUID()
  const ver = rnd(CHROME_VERSIONS)
  _userAgent = `Mozilla/5.0 (${rnd(PLATFORMS)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`
}

/** Bật/tắt fake device (bật thì randomize ngay). */
export function setFakeDevice(on: boolean): void {
  _fakeOn = on
  if (on) randomizeDevice()
}

function headers(): Record<string, string> {
  const major = _userAgent.match(/Chrome\/(\d+)/)?.[1] || '149'
  return {
    accept: 'application/json',
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
    'content-type': 'application/json',
    'device-encode': _deviceEncode,
    localization: 'vi',
    origin: 'https://go2joy.vn',
    referer: 'https://go2joy.vn/',
    requester: 'web-app',
    'sec-ch-ua': `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not)A;Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': _userAgent.includes('Mac') ? '"macOS"' : '"Windows"',
    'user-agent': _userAgent,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function errBody(res: Response, path: string): Promise<Error> {
  let detail = ''
  try {
    const t = await res.text()
    const j = JSON.parse(t)
    detail = j?.error?.[0]?.message || j?.message || t
  } catch { /* giữ rỗng */ }
  return new Error(`HTTP ${res.status} @ ${path}${detail ? ' — ' + String(detail).slice(0, 200) : ''}`)
}

// ----- Proxy (undici) -----
import { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'

const _defaultDispatcher = getGlobalDispatcher()
let _rotateHandler: (() => Promise<void>) | null = null

/** Bật/tắt proxy cho toàn bộ request (rỗng = tắt). */
export function setProxy(url?: string): void {
  setGlobalDispatcher(url ? new ProxyAgent(url) : _defaultDispatcher)
}

/** Đặt hàm đổi IP — gọi khi bị chặn (vd tmproxy get-new-proxy). */
export function setRotateHandler(fn: (() => Promise<void>) | null): void {
  _rotateHandler = fn
}

/** Thử lại khi bị Go2Joy chặn ("Too many attempts" / 429): đổi IP (nếu có) + đợi tăng dần. */
async function withThrottleRetry<T>(fn: () => Promise<T>, retries = 8): Promise<T> {
  let delay = 2000
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      const msg = String(e?.message || e)
      const throttled = /too many attempts|rate ?limit|429/i.test(msg)
      if (!throttled || attempt >= retries) throw e
      if (_rotateHandler) {
        try { await _rotateHandler() } catch { /* đổi IP lỗi -> vẫn đợi rồi thử lại */ }
      }
      await sleep(delay)
      delay = Math.min(delay * 2, 30000)
    }
  }
}

async function apiGet(path: string, params?: Record<string, string | number>): Promise<any> {
  return withThrottleRetry(async () => {
    const url = new URL(`${API_BASE}/${path}`)
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    const res = await fetch(url, { headers: headers() })
    if (!res.ok) throw await errBody(res, path)
    return res.json()
  })
}

async function apiPost(path: string, body: unknown): Promise<any> {
  return withThrottleRetry(async () => {
    const res = await fetch(`${API_BASE}/${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) throw await errBody(res, path)
    return res.json()
  })
}

function stripHtml(s?: string): string {
  if (!s) return ''
  let t = String(s).replace(/<[^>]+>/g, '\n')
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return t
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

function extractPhone(...texts: (string | undefined)[]): string {
  const re = /(0\d[\d\s.\-]{7,12}\d)/
  for (const t of texts) {
    if (!t) continue
    const m = String(t).match(re)
    if (m) return m[1].replace(/[\s.\-]/g, '')
  }
  return ''
}

function imageUrl(p?: string, width = IMAGE_WIDTH): string {
  if (!p) return ''
  return `${IMAGE_BASE}/${width}/${String(p).replace(/^\/+/, '')}`
}

const hotelLink = (sn: number) => `https://go2joy.vn/hotel/${sn}`

function formatPrice(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  return n.toLocaleString('vi-VN').replace(/,/g, '.') + 'đ'
}

export async function getProvinces(): Promise<Province[]> {
  const body = await apiGet('home/getSiteMapList')
  const data: Province[] = body.data || []
  return data.slice().sort((a, b) => (b.totalHotel || 0) - (a.totalHotel || 0))
}

interface ListSearch {
  provinceSn: number
  bookingType: BookingType
  checkinDate: string
  endDate?: string
  startTime: string
  endTime: string
  minPrice: number
  maxPrice: number
  sort: number
  limit: number
}

function buildListPayload(s: ListSearch, page: number) {
  return {
    provinceSn: s.provinceSn,
    minPrice: s.minPrice,
    facility: [],
    provinceList: [],
    ranking: 1,
    maxPrice: s.maxPrice,
    sort: s.sort,
    filterByRating: '',
    rateReviewClean: '',
    bookingType: s.bookingType,
    promotion: 0,
    hasFilter: true,
    limit: s.limit,
    page,
    endTime: s.endTime,
    startTime: s.startTime,
    checkInDatePlan: s.checkinDate,
    endDate: s.endDate || s.checkinDate,
    nationwide: false,
    distance: null,
    isShareLocation: false,
  }
}

interface IterOpts {
  onHotel: (h: any) => Promise<void> | void
  onProgress?: (fetched: number, total: number) => void
  shouldStop?: () => boolean
  delay?: number
  maxPages?: number
}

export async function iterHotelList(search: ListSearch, opts: IterOpts): Promise<void> {
  const { onHotel, onProgress, shouldStop, delay = 400, maxPages = 0 } = opts
  let page = 1
  let total: number | null = null
  let fetched = 0
  while (true) {
    if (shouldStop?.()) return
    const body = await apiPost('hotel/getHotelList', buildListPayload(search, page))
    if (body.code !== 1) throw new Error(body.message || 'API error')
    const data = body.data || {}
    const batch: any[] = data.hotelList || []
    const meta = data.meta || {}
    if (total === null) total = meta.total || 0
    for (const h of batch) {
      if (shouldStop?.()) return
      fetched += 1
      await onHotel(h)
    }
    onProgress?.(fetched, total)
    if (!meta.hasNext || batch.length === 0) return
    if (maxPages && page >= maxPages) return
    page += 1
    if (delay) await sleep(delay)
  }
}

interface RoomQuery {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

/** Danh sách phòng (room type) của 1 khách sạn cho 1 loại thuê + khung giờ. */
export async function getRoomTypeList(
  hotelSn: number,
  bookingType: BookingType,
  q: RoomQuery,
): Promise<any[]> {
  try {
    const body = await apiGet('roomType/getRoomTypeList', {
      hotelSn,
      bookingType,
      startDate: q.startDate,
      startTime: q.startTime,
      endDate: q.endDate,
      endTime: q.endTime,
    })
    if (body.code !== 1) return []
    return body.data?.roomTypeList || []
  } catch {
    return []
  }
}

export async function getHotelDetail(hotelSn: number): Promise<any> {
  try {
    const body = await apiGet('hotel/getHotelDetail', { hotelSn })
    if (body.code !== 1) return {}
    return body.data || {}
  } catch {
    return {}
  }
}

function buildPolicy(d: any): string {
  const parts: string[] = []
  if (d.startHourlyTime != null && d.endHourlyTime != null)
    parts.push(`Theo giờ: ${d.startHourlyTime}:00 – ${d.endHourlyTime}:00`)
  if (d.startOvernight != null && d.endOvernight != null)
    parts.push(`Qua đêm: ${d.startOvernight}:00 – ${d.endOvernight}:00`)
  if (d.checkin != null && d.checkout != null)
    parts.push(`Theo ngày: nhận ${d.checkin}:00, trả ${d.checkout}:00`)
  return parts.join('\n')
}

function buildAmenities(d: any): string {
  const fl: any[] = d.facilityList || []
  return fl
    .map((f) => (typeof f === 'string' ? f : f && (f.name || f.facilityName)))
    .filter(Boolean)
    .join('\n')
}

function buildImages(d: any): string[] {
  return (d.hotelImageList || [])
    .map((i: any) => imageUrl(i.imagePath))
    .filter(Boolean)
}

/** 1 dòng cho MỖI PHÒNG (room type) — khớp template (mỗi phòng 1 dòng). */
export function mapRoomRow(
  hotel: any,
  detail: any,
  room: any,
  ctx: { provinceName: string; bookingType: BookingType; combo: string },
): HotelRow {
  const dr = room.displayRule || {}
  const d = detail || {}
  const desc = stripHtml(d.description)
  const imgs = (room.roomTypeImageList || [])
    .map((i: any) => imageUrl(i.imagePath))
    .filter(Boolean)
  const roomFacilities = (room.roomFacilityList || [])
    .map((f: any) => f?.name)
    .filter(Boolean)
    .join('\n')
  return {
    'tỉnh': ctx.provinceName,
    'loại thuê': BOOKING_TYPES[ctx.bookingType].label,
    'tên ks': hotel.name || '',
    'địa chỉ': hotel.address || '',
    'link': hotelLink(hotel.sn),
    'danh sách phòng': room.name || '',
    'ảnh link tổng': imgs.join('\n'),
    'giá': format_price_room(dr),
    'combo giờ': dr.priceTypeText || ctx.combo,
    'tiện ích': roomFacilities || buildAmenities(d),
    'giới thiệu': desc,
    'chính sách nhận - trả phòng': buildPolicy(d),
    'sđt chủ': room.hotelPhone || extractPhone(d.description, desc),
    'airbnb': '',
    // dữ liệu ẩn cho Drive (không ghi ra sheet — sheet chỉ dùng SHEET_COLUMNS)
    '__hotelSn': String(hotel.sn || ''),
    '__hotelImages': buildImages(d).join('\n'),
    '__roomImages': imgs.join('\n'),
  }
}

function format_price_room(dr: any): string {
  return formatPrice(dr.discountPrice || dr.originPrice || dr.firstHoursOrigin)
}

export function mapRow(
  hotel: any,
  detail: any,
  ctx: { provinceName: string; bookingType: BookingType; combo: string },
): HotelRow {
  const dr = hotel.displayRule || {}
  const d = detail || {}
  const desc = stripHtml(d.description)
  return {
    'tỉnh': ctx.provinceName,
    'loại thuê': BOOKING_TYPES[ctx.bookingType].label,
    'tên ks': hotel.name || '',
    'địa chỉ': hotel.address || '',
    'link': hotelLink(hotel.sn),
    'danh sách phòng': '',
    'ảnh link tổng': buildImages(d).join('\n'),
    'giá': formatPrice(dr.discountPrice || dr.originPrice),
    'combo giờ': ctx.combo,
    'tiện ích': buildAmenities(d),
    'giới thiệu': desc,
    'chính sách nhận - trả phòng': buildPolicy(d),
    'sđt chủ': extractPhone(d.description, desc),
    'airbnb': '',
    '__hotelSn': String(hotel.sn || ''),
    '__hotelImages': buildImages(d).join('\n'),
    '__roomImages': '',
  }
}
