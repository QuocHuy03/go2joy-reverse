import { useScraper } from './useScraper'
import { useGoogle } from './useGoogle'
import { OptionsPanel } from './components/OptionsPanel'
import { GooglePanel } from './components/GooglePanel'
import { ResultsTable } from './components/ResultsTable'
import { HotelIcon } from './icons'

export default function App() {
  const s = useScraper()
  const g = useGoogle(s.getRows, s.log)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><HotelIcon width={22} height={22} /></span>
          <div>
            <h1>Go2Joy Hotel Scraper</h1>
            <p className="subtitle">Cào khách sạn · lưu Google Sheet · upload ảnh lên Drive</p>
          </div>
        </div>
        <div className="stats">
          <div className="stat">
            <span className="stat-num">{s.rows.length}</span>
            <span className="stat-label">dòng</span>
          </div>
          <div className="stat">
            <span className="stat-num">{s.provinces.length}</span>
            <span className="stat-label">tỉnh/thành</span>
          </div>
        </div>
      </header>

      <main className="layout">
        <div className="sidebar">
          <OptionsPanel
            provinces={s.provinces}
            running={s.running}
            hasRows={s.rows.length > 0}
            onStart={s.start}
            onStop={s.stop}
            onExportXlsx={s.exportXlsx}
            onExportCsv={s.exportCsv}
          />
          <GooglePanel
            running={g.running}
            progress={g.progress}
            result={g.result}
            hasRows={s.rows.length > 0}
            doneSignal={s.doneSignal}
            onRun={g.run}
          />
        </div>

        <section className="panel result">
          <div className="progress-wrap">
            <div className="progress">
              <div
                className={`progress-bar${s.progress.indeterminate ? ' indeterminate' : ''}`}
                style={s.progress.indeterminate ? undefined : { width: `${s.progress.pct}%` }}
              />
            </div>
            <span className="progress-text">{s.progress.text}</span>
          </div>

          <ResultsTable rows={s.rows} />

          <pre className="log">{s.logs.join('\n')}</pre>
        </section>
      </main>
    </div>
  )
}
