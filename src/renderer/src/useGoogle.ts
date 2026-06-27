import { useEffect, useState } from 'react'
import type { GoogleConfig, GoogleResult, HotelRow } from '@shared/types'

export function useGoogle(getRows: () => HotelRow[], log: (m: string) => void) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<GoogleResult | null>(null)

  useEffect(() => {
    const offs = [
      window.go2joy.onGoogleProgress(({ stage, done, total }) => {
        setProgress(`${stage} ${done}/${total}`)
      }),
      window.go2joy.onGoogleDone((r) => {
        setRunning(false)
        setResult(r)
        if (r.ok) {
          log(`Google xong: ${r.folders ?? 0} folder, ${r.uploaded ?? 0} ảnh${r.skipped ? `, bỏ qua ${r.skipped}` : ''}${r.failed ? `, LỖI ${r.failed}` : ''}.`)
          if (r.failed && r.firstError) log(`Lý do ảnh lỗi: ${r.firstError}`)
          if (r.masterFolderUrl) log(`Folder Drive: ${r.masterFolderUrl}`)
          if (r.sheetUrl) log(`Đã ghi Sheet: ${r.sheetUrl}`)
        }
      }),
      window.go2joy.onGoogleError((msg) => {
        setRunning(false)
        setProgress('Lỗi')
        log('Lỗi Google: ' + msg)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [log])

  const run = (cfg: Omit<GoogleConfig, 'rows'>) => {
    const rows = getRows()
    if (!rows.length) {
      alert('Chưa có dữ liệu để lưu. Hãy cào trước.')
      return
    }
    if (!cfg.doSheet && !cfg.doDrive) {
      alert('Chọn ít nhất Sheet hoặc Drive.')
      return
    }
    if (cfg.doSheet && !cfg.sheetCredPath) {
      alert('Chọn file service account cho Sheet.')
      return
    }
    if (cfg.doSheet && !cfg.sheetUrl.trim()) {
      alert('Nhập link Google Sheet.')
      return
    }
    setRunning(true)
    setResult(null)
    setProgress('Bắt đầu…')
    window.go2joy.runGoogle({ ...cfg, rows })
  }

  return { running, progress, result, run } as const
}
