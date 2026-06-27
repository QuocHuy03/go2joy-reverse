// Đăng nhập Google bằng OAuth (loopback) — để file thuộc Drive của người dùng,
// tránh lỗi "Service Accounts do not have storage quota".
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { shell } from 'electron'
import { google } from 'googleapis'
import { getSection, setSection } from './store'

const SCOPES = [
  // drive.file: chỉ truy cập file/thư mục do chính app tạo -> loại "sensitive"
  // (qua được màn cảnh báo khi Publish, không bị chặn như scope "restricted" drive)
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
]

function readClient(path?: string): { clientId: string; clientSecret: string } {
  if (!path) {
    throw new Error('Chưa chọn OAuth Client JSON (Desktop app) cho Drive. Hãy chọn file rồi đăng nhập.')
  }
  const j = JSON.parse(readFileSync(path, 'utf8'))
  const c = j.installed || j.web || j
  if (!c.client_id || !c.client_secret) {
    throw new Error('File không phải OAuth Client (thiếu client_id/client_secret). Tạo loại "Desktop app".')
  }
  return { clientId: c.client_id, clientSecret: c.client_secret }
}

const tokenKey = (clientId: string) => `oauth_token::${clientId}`

/** Trả về OAuth2Client đã có refresh token (đã đăng nhập trước đó). */
export function getOAuthClient(clientPath?: string) {
  const { clientId, clientSecret } = readClient(clientPath)
  const saved = getSection(tokenKey(clientId))
  if (!saved?.refresh_token) {
    throw new Error('Chưa đăng nhập Google. Bấm "Đăng nhập Google" trước khi lưu.')
  }
  const oAuth2 = new google.auth.OAuth2(clientId, clientSecret)
  oAuth2.setCredentials({ refresh_token: saved.refresh_token })
  return oAuth2
}

/** Trạng thái đăng nhập (email đã lưu) cho 1 client. */
export function getOAuthStatus(clientPath?: string): { loggedIn: boolean; email: string } {
  try {
    const { clientId } = readClient(clientPath)
    const saved = getSection(tokenKey(clientId))
    return { loggedIn: !!saved?.refresh_token, email: saved?.email || '' }
  } catch {
    return { loggedIn: false, email: '' }
  }
}

/** Mở trình duyệt cho người dùng đăng nhập, lưu refresh token vào SQLite. */
export function loginOAuth(clientPath?: string): Promise<{ ok: boolean; email: string }> {
  const { clientId, clientSecret } = readClient(clientPath)
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      const redirectUri = `http://127.0.0.1:${port}`
      const oAuth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
      const authUrl = oAuth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
      })

      server.on('request', async (req, res) => {
        try {
          const url = new URL(req.url || '', redirectUri)
          const code = url.searchParams.get('code')
          const err = url.searchParams.get('error')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          if (err || !code) {
            res.end('<h2>Đăng nhập thất bại. Đóng tab và thử lại.</h2>')
            server.close()
            reject(new Error(err || 'Không nhận được mã code'))
            return
          }
          res.end('<h2>Đăng nhập thành công! Quay lại ứng dụng nhé.</h2>')
          server.close()

          const { tokens } = await oAuth2.getToken(code)
          oAuth2.setCredentials(tokens)
          let email = ''
          try {
            const oa = google.oauth2({ version: 'v2', auth: oAuth2 })
            const me = await oa.userinfo.get()
            email = me.data.email || ''
          } catch { /* không lấy được email cũng không sao */ }

          const prev = getSection(tokenKey(clientId)) || {}
          const refresh_token = tokens.refresh_token || prev.refresh_token
          if (!refresh_token) {
            reject(new Error('Không nhận được refresh_token. Hãy thử lại và bấm "Allow/Cho phép".'))
            return
          }
          setSection(tokenKey(clientId), { refresh_token, email })
          resolve({ ok: true, email })
        } catch (e) {
          try { server.close() } catch { /* ignore */ }
          reject(e)
        }
      })

      shell.openExternal(authUrl)
    })
  })
}
