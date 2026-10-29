import { useEffect, useState } from 'react'
import { getHealth } from './lib/api'
import './App.css'

type ConnectionState = 'checking' | 'connected' | 'disconnected'

function App() {
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')

  useEffect(() => {
    let active = true

    getHealth()
      .then(() => {
        if (active) setConnectionState('connected')
      })
      .catch(() => {
        if (active) setConnectionState('disconnected')
      })

    return () => {
      active = false
    }
  }, [])

  const connectionLabel = {
    checking: '서버 연결 확인 중',
    connected: 'API 연결됨',
    disconnected: 'API 연결 안 됨',
  }[connectionState]

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="레퍼런스 메이커 홈">
          <span className="brand-mark" aria-hidden="true">
            R
          </span>
          <span>레퍼런스 메이커</span>
        </a>
        <span className={`connection connection--${connectionState}`} role="status">
          <span className="connection-dot" aria-hidden="true" />
          {connectionLabel}
        </span>
      </header>

      <section className="welcome" aria-labelledby="welcome-title">
        <p className="eyebrow">REFERENCE DESIGN MAKER</p>
        <h1 id="welcome-title">좋은 디자인의 단서를 모아보세요.</h1>
        <p className="welcome-copy">
          레퍼런스를 프로젝트별로 정리하고, 나만의 디자인 방향을 만들어가는 공간입니다.
        </p>
        <div className="setup-card">
          <div className="setup-icon" aria-hidden="true">
            ↗
          </div>
          <div>
            <h2>개발 환경 준비 중</h2>
            <p>다음 단계에서 프로젝트와 레퍼런스를 저장하는 기능을 연결합니다.</p>
          </div>
        </div>
      </section>

      <footer className="footer">
        <span>내 디자인 라이브러리</span>
        <span>Chrome 우선 지원 · Edge 호환 확인</span>
      </footer>
    </main>
  )
}

export default App
