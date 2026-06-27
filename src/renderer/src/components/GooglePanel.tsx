import { useEffect, useRef, useState } from 'react'
import type { GoogleResult } from '@shared/types'
import { CloudIcon, FileIcon, CheckIcon, SheetIcon } from '../icons'
import { usePersistedSection } from '../usePersisted'

interface RunCfg {
  sheetCredPath: string
  oauthClientPath: string
  sheetUrl: string
  sheetTab: string
  doSheet: boolean
  doDrive: boolean
  writeMode: 'append' | 'overwrite'
  driveParentId: string
  masterFolderName: string
}

interface Props {
  running: boolean
  progress: string
  result: GoogleResult | null
  hasRows: boolean
  doneSignal: number
  onRun: (cfg: RunCfg) => void
}

function FilePick({ label, hint, path, onPick }: {
  label: string; hint: string; path: string; onPick: (p: string) => void
}) {
  const pick = async () => {
    const res = await window.go2joy.pickJson()
    if (res.ok && res.path) onPick(res.path)
  }
  const name = path ? path.split(/[\\/]/).pop() : ''
  return (
    <label className="field">
      <span>{label}</span>
      <button type="button" className={`file-pick${name ? ' has-file' : ''}`} onClick={pick}>
        <span className="fp-icon">{name ? <CheckIcon /> : <FileIcon />}</span>
        <span className="fp-text" title={path}>
          {name || <span className="fp-hint">{hint}</span>}
        </span>
      </button>
    </label>
  )
}

export function GooglePanel({ running, progress, result, hasRows, doneSignal, onRun }: Props) {
  const [sheetCred, setSheetCred] = useState('')
  const [oauthClient, setOauthClient] = useState('')
  const [oauthEmail, setOauthEmail] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [sheetUrl, setSheetUrl] = useState('')
  const [sheetTab, setSheetTab] = useState('go2joy')
  const [doSheet, setDoSheet] = useState(true)
  const [doDrive, setDoDrive] = useState(true)
  const [autoSave, setAutoSave] = useState(true)
  const [writeMode, setWriteMode] = useState<'append' | 'overwrite'>('append')
  const [driveParentId, setDriveParentId] = useState('')
  const [masterFolderName, setMasterFolderName] = useState('Go2Joy - Ảnh khách sạn')

  usePersistedSection(
    'google',
    { sheetCred, oauthClient, sheetUrl, sheetTab, doSheet, doDrive, autoSave, writeMode, driveParentId, masterFolderName },
    (s) => {
      if (typeof s.sheetCred === 'string') setSheetCred(s.sheetCred)
      if (typeof s.oauthClient === 'string') setOauthClient(s.oauthClient)
      if (typeof s.sheetUrl === 'string') setSheetUrl(s.sheetUrl)
      if (typeof s.sheetTab === 'string') setSheetTab(s.sheetTab)
      if (typeof s.doSheet === 'boolean') setDoSheet(s.doSheet)
      if (typeof s.doDrive === 'boolean') setDoDrive(s.doDrive)
      if (typeof s.autoSave === 'boolean') setAutoSave(s.autoSave)
      if (s.writeMode === 'append' || s.writeMode === 'overwrite') setWriteMode(s.writeMode)
      if (typeof s.driveParentId === 'string') setDriveParentId(s.driveParentId)
      if (typeof s.masterFolderName === 'string') setMasterFolderName(s.masterFolderName)
    },
  )

  // trạng thái đăng nhập Drive
  useEffect(() => {
    if (!oauthClient) { setOauthEmail(''); return }
    window.go2joy.oauthStatus(oauthClient).then((st) => {
      setOauthEmail(st.loggedIn ? (st.email || '(đã đăng nhập)') : '')
    })
  }, [oauthClient])

  const login = async () => {
    if (!oauthClient) { alert('Chọn file OAuth Client JSON (Desktop app) trước.'); return }
    setLoggingIn(true)
    const res = await window.go2joy.googleLogin(oauthClient)
    setLoggingIn(false)
    if (res.ok) setOauthEmail(res.email || '(đã đăng nhập)')
    else alert('Đăng nhập lỗi: ' + (res.error || '?'))
  }

  const run = () =>
    onRun({
      sheetCredPath: sheetCred,
      oauthClientPath: oauthClient,
      sheetUrl, sheetTab, doSheet, doDrive, writeMode, driveParentId, masterFolderName,
    })

  // tự động lưu khi quét xong
  const lastSignal = useRef(0)
  useEffect(() => {
    if (doneSignal === 0 || doneSignal === lastSignal.current) return
    lastSignal.current = doneSignal
    if (!autoSave || running) return
    if (doSheet && (!sheetCred || !sheetUrl.trim())) return
    if (doDrive && (!oauthClient || !oauthEmail)) return
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneSignal])

  return (
    <aside className="panel google">
      <h2 className="panel-title"><CloudIcon /> Lưu vào Google</h2>

      {/* ───── Sheet: service account ───── */}
      <span className="section-label"><SheetIcon width={13} height={13} /> Google Sheet · Service account</span>
      <FilePick label="JSON service account (cho Sheet)" hint="chọn demo.json…" path={sheetCred} onPick={setSheetCred} />
      <label className="field">
        <span>Link Google Sheet</span>
        <input type="text" placeholder="https://docs.google.com/spreadsheets/d/…"
          value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>Tên tab (sheet)</span>
          <input type="text" value={sheetTab} onChange={(e) => setSheetTab(e.target.value)} />
        </label>
        <label className="field">
          <span>Chế độ ghi</span>
          <select value={writeMode} onChange={(e) => setWriteMode(e.target.value as 'append' | 'overwrite')}>
            <option value="append">Nối tiếp</option>
            <option value="overwrite">Ghi đè</option>
          </select>
        </label>
      </div>

      {/* ───── Drive: OAuth ───── */}
      <span className="section-label"><CloudIcon width={13} height={13} /> Google Drive · OAuth (tài khoản bạn)</span>
      <div className="login-row">
        <button type="button" className="btn small" disabled={loggingIn} onClick={login}>
          {loggingIn ? 'Đang mở trình duyệt…' : (oauthEmail ? 'Đăng nhập lại' : 'Đăng nhập Google')}
        </button>
        <span className={`login-status${oauthEmail ? ' ok' : ''}`}>
          {oauthEmail ? `Đã đăng nhập: ${oauthEmail}` : 'Chưa đăng nhập'}
        </span>
      </div>
      <p className="g-note">Drive bắt buộc OAuth (service account không có dung lượng). Chọn OAuth Client JSON (Desktop app) rồi bấm Đăng nhập — chỉ làm 1 lần.</p>
      <FilePick label="OAuth Client JSON (Desktop app)" hint="chọn oauth.json…" path={oauthClient} onPick={setOauthClient} />
      <label className="field">
        <span>Tên folder tổng</span>
        <input type="text" value={masterFolderName} onChange={(e) => setMasterFolderName(e.target.value)} />
      </label>
      <label className="field">
        <span>Folder gốc Drive <small>(ID — tuỳ chọn)</small></span>
        <input type="text" placeholder="để trống = tạo trong Drive của bạn"
          value={driveParentId} onChange={(e) => setDriveParentId(e.target.value)} />
      </label>

      {/* ───── tuỳ chọn ───── */}
      <span className="section-label">Tuỳ chọn lưu</span>
      <div className="check-grid">
        <label className="check-row">
          <input type="checkbox" checked={doSheet} onChange={(e) => setDoSheet(e.target.checked)} />
          <span>Ghi bảng vào Google Sheet</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={doDrive} onChange={(e) => setDoDrive(e.target.checked)} />
          <span>Upload ảnh lên Drive (folder con theo tên ks + phòng)</span>
        </label>
        <label className="check-row auto-row">
          <input type="checkbox" checked={autoSave} onChange={(e) => setAutoSave(e.target.checked)} />
          <span><b>Tự động lưu</b> ngay sau khi quét xong</span>
        </label>
      </div>

      <div className="actions">
        <button className="btn primary" disabled={running || !hasRows} onClick={run}>
          <CloudIcon /> {running ? 'Đang lưu…' : 'Lưu lên Google'}
        </button>
      </div>

      {running && <p className="g-progress">{progress}</p>}
      {result?.ok && (
        <div className="g-result">
          {result.folders != null && (
            <div>
              Đã tạo {result.folders} folder · {result.uploaded} ảnh
              {result.skipped ? ` · bỏ qua ${result.skipped}` : ''}
              {result.failed ? ` · lỗi ${result.failed}` : ''}
            </div>
          )}
          {result.failed && result.firstError
            ? <div className="g-err">Lý do: {result.firstError}</div> : null}
          {result.masterFolderUrl && <a href={result.masterFolderUrl} target="_blank" rel="noreferrer">Mở folder Drive</a>}
          {result.sheetUrl && <a href={result.sheetUrl} target="_blank" rel="noreferrer">Mở Google Sheet</a>}
        </div>
      )}
    </aside>
  )
}
