import type { BookingType } from './types'

export const BOOKING_TYPES: Record<BookingType, { label: string; combo: (n: number) => string }> = {
  1: { label: 'theo giờ', combo: (n) => `${n}h` },
  2: { label: 'qua đêm', combo: () => '1 đêm' },
  3: { label: 'theo ngày', combo: () => '1 ngày' },
}

/** Màu nền cột "loại thuê" theo sheet mẫu (hex không có #). */
export const BOOKING_COLORS: Record<string, string> = {
  'theo giờ': 'FFF200',
  'qua đêm': '00E5FF',
  'theo ngày': 'A020F0',
}

export const SHEET_COLUMNS = [
  'tỉnh', 'loại thuê', 'tên ks', 'địa chỉ', 'link',
  'danh sách phòng', 'ảnh link tổng', 'giá', 'combo giờ',
  'tiện ích', 'giới thiệu', 'chính sách nhận - trả phòng',
  'sđt chủ', 'airbnb', 'lat', 'lng',
] as const

/** Cột hiển thị trong bảng UI (gọn, chuyên nghiệp) — dữ liệu vẫn giữ đủ 16 cột. */
export const DISPLAY_COLUMNS = [
  'loại thuê', 'tên ks', 'giá', 'combo giờ', 'địa chỉ', 'sđt chủ', 'lat', 'lng',
] as const
