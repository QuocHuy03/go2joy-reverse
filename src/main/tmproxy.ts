// Tích hợp tmproxy (proxy xoay) — https://docs.tmproxy.com/tmproxy-apis/
const BASE = 'https://tmproxy.com/api/proxy'

async function call(path: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`tmproxy HTTP ${res.status}`)
  const text = await res.text()
  try { return JSON.parse(text) } catch { throw new Error(`tmproxy response không phải JSON: ${text.slice(0, 100)}`) }
}

/** data.https = "ip:port" (+ username/password nếu auth user/pass). */
function toUrl(data: any): string {
  if (!data?.https) return ''
  const u = data.username
  const p = data.password
  return u && p
    ? `http://${encodeURIComponent(u)}:${encodeURIComponent(p)}@${data.https}`
    : `http://${data.https}`
}

function pickUrl(j: any): string {
  return j?.code === 0 && j?.data?.https ? toUrl(j.data) : ''
}

/** Lấy proxy để bắt đầu: ưu tiên proxy hiện tại, chưa có thì xin mới. */
export async function acquireProxy(apiKey: string): Promise<string> {
  let j = await call('get-current-proxy', { api_key: apiKey })
  let url = pickUrl(j)
  if (url) return url
  j = await call('get-new-proxy', { api_key: apiKey, id_location: 0, id_isp: 0 })
  url = pickUrl(j)
  if (url) return url
  throw new Error(`tmproxy: ${j?.message || 'không lấy được proxy'}`)
}

/** Đổi IP mới; nếu đang cooldown thì dùng proxy hiện tại. */
export async function rotateProxy(apiKey: string): Promise<string> {
  let j = await call('get-new-proxy', { api_key: apiKey, id_location: 0, id_isp: 0 })
  let url = pickUrl(j)
  if (url) return url
  j = await call('get-current-proxy', { api_key: apiKey })
  url = pickUrl(j)
  if (url) return url
  throw new Error(`tmproxy: ${j?.message || 'không đổi được proxy'}`)
}
