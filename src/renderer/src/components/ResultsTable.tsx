import { DISPLAY_COLUMNS, BOOKING_COLORS } from '@shared/constants'
import type { HotelRow } from '@shared/types'

const COLOR_HEX: Record<string, string> = Object.fromEntries(
  Object.entries(BOOKING_COLORS).map(([k, v]) => [k, '#' + v]),
)

export function ResultsTable({ rows }: { rows: HotelRow[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th className="idx">#</th>
            {DISPLAY_COLUMNS.map((c) => (
              <th key={c}>{c}</th>
            ))}
            <th>ảnh</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const imgCount = (row['ảnh link tổng'] || '').split('\n').filter(Boolean).length
            return (
              <tr key={i} className="flash">
                <td className="idx">{i + 1}</td>
                {DISPLAY_COLUMNS.map((c) => {
                  const val = String(row[c] ?? '').replace(/\n/g, ' | ')
                  const isBt = c === 'loại thuê'
                  return (
                    <td key={c} title={val} className={isBt ? 'bt' : undefined}>
                      {isBt
                        ? <span className="badge" style={{ background: COLOR_HEX[row[c]] }}>{val}</span>
                        : val}
                    </td>
                  )
                })}
                <td className="img-cell">{imgCount > 0 ? `${imgCount} ảnh` : '—'}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td className="empty" colSpan={DISPLAY_COLUMNS.length + 2}>
                Chưa có dữ liệu. Chọn tuỳ chọn rồi bấm “Bắt đầu cào”.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
