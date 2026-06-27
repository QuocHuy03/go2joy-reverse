import { useMemo, useState } from 'react'
import type { BookingType, Province, SearchParams } from '@shared/types'
import { PlayIcon, StopIcon, DownloadIcon, MapPinIcon } from '../icons'
import { usePersistedSection } from '../usePersisted'

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

function defaultDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

interface Props {
  provinces: Province[]
  running: boolean
  hasRows: boolean
  onStart: (p: SearchParams) => void
  onStop: () => void
  onExportXlsx: (name: string) => void
  onExportCsv: (name: string) => void
}

export function OptionsPanel({
  provinces, running, hasRows, onStart, onStop, onExportXlsx, onExportCsv,
}: Props) {
  const [provinceSn, setProvinceSn] = useState<number>(2)
  const [bt, setBt] = useState<Record<BookingType, boolean>>({ 1: true, 2: false, 3: false })
  const [checkinDate, setCheckinDate] = useState(defaultDate())
  const [startTime, setStartTime] = useState('00:00')
  const [duration, setDuration] = useState(2)
  const [sort, setSort] = useState(0)
  const [minPrice, setMinPrice] = useState(20000)
  const [maxPrice, setMaxPrice] = useState(10000000)
  const [maxPages, setMaxPages] = useState(0)
  const [fetchDetail, setFetchDetail] = useState(true)

  // chọn Hà Nội khi danh sách tỉnh về (nếu có)
  useMemo(() => {
    if (provinces.length && !provinces.some((p) => p.sn === provinceSn)) {
      setProvinceSn(provinces[0].sn)
    }
  }, [provinces]) // eslint-disable-line react-hooks/exhaustive-deps

  const province = provinces.find((p) => p.sn === provinceSn)

  // lưu/nạp tuỳ chọn tìm kiếm vào SQLite (không lưu ngày để luôn mới)
  usePersistedSection(
    'search',
    { provinceSn, bt, startTime, duration, sort, minPrice, maxPrice, maxPages, fetchDetail },
    (s) => {
      if (typeof s.provinceSn === 'number') setProvinceSn(s.provinceSn)
      if (s.bt && typeof s.bt === 'object') setBt(s.bt as Record<BookingType, boolean>)
      if (typeof s.startTime === 'string') setStartTime(s.startTime)
      if (typeof s.duration === 'number') setDuration(s.duration)
      if (typeof s.sort === 'number') setSort(s.sort)
      if (typeof s.minPrice === 'number' && s.minPrice >= 0) setMinPrice(s.minPrice)
      if (typeof s.maxPrice === 'number' && s.maxPrice > 0) setMaxPrice(s.maxPrice)
      if (typeof s.maxPages === 'number') setMaxPages(s.maxPages)
      if (typeof s.fetchDetail === 'boolean') setFetchDetail(s.fetchDetail)
    },
  )

  const buildName = (ext: string) => {
    const name = (province?.name || 'go2joy')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
    return `go2joy_${name}_${checkinDate.replace(/-/g, '')}.${ext}`
  }

  const start = () => {
    const bookingTypes = ([1, 2, 3] as BookingType[]).filter((k) => bt[k])
    if (!bookingTypes.length) {
      alert('Chọn ít nhất một loại thuê.')
      return
    }
    const endH = (parseInt(startTime.slice(0, 2), 10) + duration) % 24
    // chặn giá trị lỗi: maxPrice<=0 hoặc < minPrice -> API trả HTTP 400
    const safeMin = Math.max(0, minPrice || 0)
    const safeMax = maxPrice && maxPrice > safeMin ? maxPrice : 10_000_000
    onStart({
      provinceSn,
      provinceName: province?.name || String(provinceSn),
      bookingTypes,
      checkinDate,
      startTime,
      endTime: `${String(endH).padStart(2, '0')}:00`,
      durationHours: duration,
      minPrice: safeMin, maxPrice: safeMax, sort, maxPages, fetchDetail,
    })
  }

  return (
    <aside className="panel options">
      <h2 className="panel-title"><MapPinIcon /> Tuỳ chọn tìm kiếm</h2>

      <span className="section-label">Địa điểm &amp; loại thuê</span>
      <label className="field">
        <span>Địa điểm</span>
        <select value={provinceSn} onChange={(e) => setProvinceSn(Number(e.target.value))}>
          {provinces.map((p) => (
            <option key={p.sn} value={p.sn}>{p.name} ({p.totalHotel} KS)</option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Loại thuê</span>
        <div className="chips">
          {([[1, 'Theo giờ'], [2, 'Qua đêm'], [3, 'Theo ngày']] as [BookingType, string][]).map(
            ([k, label]) => (
              <label key={k} className={`chip${bt[k] ? ' on' : ''}`}>
                <input type="checkbox" checked={bt[k]}
                  onChange={(e) => setBt((s) => ({ ...s, [k]: e.target.checked }))} />
                <span>{label}</span>
              </label>
            ),
          )}
        </div>
      </div>

      <span className="section-label">Thời gian</span>
      <div className="grid2">
        <label className="field">
          <span>Ngày nhận</span>
          <input type="date" value={checkinDate} onChange={(e) => setCheckinDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Giờ nhận</span>
          <select value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </label>
      </div>

      <div className="grid2">
        <label className="field">
          <span>Số giờ (combo)</span>
          <input type="number" min={1} max={24} value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 1)} />
        </label>
        <label className="field">
          <span>Sắp xếp</span>
          <select value={sort} onChange={(e) => setSort(Number(e.target.value))}>
            <option value={0}>Mặc định</option>
            <option value={1}>Giá tăng dần</option>
            <option value={2}>Giá giảm dần</option>
          </select>
        </label>
      </div>

      <span className="section-label">Giá &amp; lọc</span>
      <div className="grid2">
        <label className="field">
          <span>Giá từ</span>
          <input type="number" step={10000} min={0} value={minPrice}
            onChange={(e) => setMinPrice(Number(e.target.value) || 0)} />
        </label>
        <label className="field">
          <span>Giá đến</span>
          <input type="number" step={100000} min={0} value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value) || 0)} />
        </label>
      </div>

      <label className="field">
        <span>Giới hạn trang <small>(0 = tất cả)</small></span>
        <input type="number" min={0} value={maxPages}
          onChange={(e) => setMaxPages(Number(e.target.value) || 0)} />
      </label>

      <label className="check-row" style={{ marginTop: 14 }}>
        <input type="checkbox" checked={fetchDetail}
          onChange={(e) => setFetchDetail(e.target.checked)} />
        <span>Lấy chi tiết (tiện ích, giới thiệu, chính sách, sđt) — chậm hơn</span>
      </label>

      <span className="section-label">Hành động</span>
      <div className="actions">
        {!running ? (
          <button className="btn primary" onClick={start}><PlayIcon /> Bắt đầu cào</button>
        ) : (
          <button className="btn danger" onClick={onStop}><StopIcon /> Dừng</button>
        )}
      </div>
      <div className="actions">
        <button className="btn" disabled={!hasRows} onClick={() => onExportXlsx(buildName('xlsx'))}>
          <DownloadIcon /> Excel
        </button>
        <button className="btn" disabled={!hasRows} onClick={() => onExportCsv(buildName('csv'))}>
          <DownloadIcon /> CSV
        </button>
      </div>
    </aside>
  )
}
