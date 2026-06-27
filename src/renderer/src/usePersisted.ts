import { useEffect, useRef, useState } from 'react'

/**
 * Nạp 1 "section" cấu hình từ SQLite local khi mount, và tự lưu lại
 * (debounce) mỗi khi `data` đổi. Trả về [loaded, applyLoaded].
 *
 * Dùng: gọi useEffect riêng để set state từ giá trị nạp về.
 */
export function usePersistedSection(
  section: string,
  data: Record<string, unknown>,
  onLoad: (saved: Record<string, unknown>) => void,
) {
  const [loaded, setLoaded] = useState(false)
  const onLoadRef = useRef(onLoad)
  onLoadRef.current = onLoad

  // nạp 1 lần
  useEffect(() => {
    let alive = true
    window.go2joy.loadSettings(section).then((saved) => {
      if (!alive) return
      if (saved && typeof saved === 'object') onLoadRef.current(saved)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [section])

  // tự lưu khi đổi (sau khi đã nạp xong)
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => window.go2joy.saveSettings(section, data), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, JSON.stringify(data)])

  return loaded
}
