import { useCallback, useEffect, useRef, useState } from 'react'
import type { HotelRow, Province, SearchParams } from '@shared/types'

export interface ScrapeState {
  provinces: Province[]
  rows: HotelRow[]
  running: boolean
  progress: { pct: number; text: string; indeterminate: boolean }
  logs: string[]
}

export function useScraper() {
  const [provinces, setProvinces] = useState<Province[]>([])
  const [rows, setRows] = useState<HotelRow[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ pct: 0, text: 'Sẵn sàng', indeterminate: false })
  const [logs, setLogs] = useState<string[]>([])
  const [doneSignal, setDoneSignal] = useState(0) // tăng mỗi lần quét xong (không bị dừng)
  const rowsRef = useRef<HotelRow[]>([])

  const log = useCallback((msg: string) => {
    setLogs((prev) => [...prev.slice(-200), msg])
  }, [])

  // tải tỉnh + đăng ký listener IPC (1 lần)
  useEffect(() => {
    window.go2joy.getProvinces().then((res) => {
      if (res.ok && res.data) {
        setProvinces(res.data)
        log(`Đã tải ${res.data.length} tỉnh/thành.`)
      } else {
        setProvinces([{ sn: 2, name: 'Hà Nội', totalHotel: 0 }])
        log(`Lỗi tải tỉnh (${res.error}); dùng Hà Nội mặc định.`)
      }
    })

    const offs = [
      window.go2joy.onRow((row) => {
        rowsRef.current = [...rowsRef.current, row]
        setRows(rowsRef.current)
      }),
      window.go2joy.onProgress(({ label, fetched, total }) => {
        const pct = total ? Math.min(100, Math.round((fetched / total) * 100)) : 0
        setProgress({ pct, text: `[${label}] ${fetched}/${total || '?'}`, indeterminate: !total })
      }),
      window.go2joy.onDone(({ count, stopped }) => {
        setRunning(false)
        setProgress({ pct: 100, text: stopped ? `Đã dừng: ${count} dòng` : `Hoàn tất: ${count} dòng`, indeterminate: false })
        log(stopped ? `Đã dừng (${count} dòng).` : `Xong: ${count} dòng.`)
        if (!stopped && count > 0) setDoneSignal((d) => d + 1)
      }),
      window.go2joy.onError((msg) => {
        setRunning(false)
        setProgress({ pct: 0, text: 'Lỗi', indeterminate: false })
        log('Lỗi: ' + msg)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [log])

  const start = useCallback((params: SearchParams) => {
    rowsRef.current = []
    setRows([])
    setRunning(true)
    setProgress({ pct: 0, text: 'Đang tải…', indeterminate: true })
    log(`Bắt đầu: ${params.provinceName} | loại [${params.bookingTypes}] | ${params.checkinDate} ${params.startTime}-${params.endTime}`)
    window.go2joy.startScrape(params)
  }, [log])

  const stop = useCallback(() => {
    window.go2joy.stopScrape()
    log('Đang dừng…')
  }, [log])

  const exportXlsx = useCallback(async (defaultName: string) => {
    const res = await window.go2joy.exportXlsx({ rows: rowsRef.current, defaultName })
    if (res.ok) log(`Đã lưu Excel: ${res.path}`)
  }, [log])

  const exportCsv = useCallback(async (defaultName: string) => {
    const res = await window.go2joy.exportCsv({ rows: rowsRef.current, defaultName })
    if (res.ok) log(`Đã lưu CSV: ${res.path}`)
  }, [log])

  const getRows = useCallback(() => rowsRef.current, [])

  return { provinces, rows, running, progress, logs, log, doneSignal, getRows, start, stop, exportXlsx, exportCsv } as const
}
