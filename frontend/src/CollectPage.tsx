import { useRef, useState, useEffect } from 'react'
import { bookmarklet } from './lib/share'
import { canInstall, installApp } from './lib/install'

export function CollectPage() {
  const button = useRef<HTMLAnchorElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [installable, setInstallable] = useState(canInstall)
  const address = bookmarklet(window.location.origin)
  useEffect(() => {
    // This is an explicitly generated bookmarklet, never a URL from shared input.
    button.current?.setAttribute('href', address)
  }, [address])
  useEffect(() => {
    const update = () => setInstallable(canInstall())
    window.addEventListener('install-availability', update)
    return () => window.removeEventListener('install-availability', update)
  }, [])
  return <section className="collect-page"><p className="eyebrow">QUICK COLLECT</p><h1>발견한 곳에서 바로 저장</h1>
    <p className="subtitle">URL을 복사해 돌아오지 않아도 돼요. 저장할 위치와 메모는 앱에서 확인하세요.</p>
    <div className="collect-methods"><article><span className="method-number">01</span><h2>북마크바에 저장 버튼 추가</h2>
      <p>아래 버튼을 브라우저의 북마크바로 드래그하세요. 외부 페이지에서 누르면 링크와 제목이 채워진 저장 화면이 열립니다.</p>
      <a ref={button} className="button bookmarklet-button" draggable onClick={event => {event.preventDefault(); setError('이 버튼을 북마크바로 드래그한 뒤 외부 페이지에서 눌러 주세요.')}}>＋ 레퍼런스 저장</a>
      <p className="hint">북마크바 표시: Ctrl + Shift + B</p>
      <button className="secondary" onClick={async () => {
        try {await navigator.clipboard.writeText(address); setCopied(true); setError('')}
        catch {setError('주소를 복사하지 못했어요. 버튼을 북마크바로 드래그해 주세요.')}
      }}>북마크 주소 복사</button>
      {copied && <p className="success" role="status">복사했습니다. 북마크의 URL 항목에 붙여넣어도 됩니다.</p>}
    </article><article><span className="method-number">02</span><h2>Chrome·Edge 확장 버튼</h2>
      <p>함께 제공된 확장 프로그램을 추가하면 브라우저 툴바의 버튼으로 현재 페이지를 보낼 수 있습니다.</p>
      <a className="button secondary" href="/reference-maker-extension.zip" download>확장 프로그램 다운로드</a>
      <ol><li>확장 프로그램을 다운로드하고 압축을 푸세요.</li>
        <li>브라우저 확장 관리에서 개발자 모드를 켜고 ‘압축해제된 확장 프로그램 로드’로 해당 폴더를 선택하세요.</li>
        <li>확장 프로그램을 툴바에 고정하고, 현재 앱 주소를 옵션에서 확인하세요.</li></ol>
      <p className="hint">현재 앱 주소: {window.location.origin}</p>
    </article><article className="collect-native"><span className="method-number">03</span><h2>앱으로 설치해 공유받기</h2>
      <p>지원하는 기기에서는 앱 설치 후 다른 앱의 공유 메뉴에서 레퍼런스 메이커를 선택할 수 있습니다. 링크·제목·텍스트를 받은 뒤 저장 화면에서 확인합니다.</p>
      {installable ? <button onClick={() => void installApp().catch(() => setError('앱 설치를 완료하지 못했어요. 브라우저의 설치 메뉴를 이용해 주세요.'))}>레퍼런스 메이커 설치</button>
        : <p className="hint">브라우저에 설치 메뉴가 표시되면 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 이용하세요. 공유 메뉴 등록은 기기·브라우저에 따라 지원이 다릅니다.</p>}
      <p className="hint">휴대전화에서는 접근 가능한 HTTPS 앱 주소가 필요합니다. 이미지는 저장 화면에서 선택하거나 붙여넣으세요.</p>
    </article></div>
    {error && <p role="status" className="notice">{error}</p>}
    <p className="hint">사이트나 브라우저가 북마크 실행을 제한하면 확장 버튼이나 앱의 URL 직접 입력을 이용하세요. 이미지는 저장 화면에서 선택·붙여넣을 수 있습니다.</p>
  </section>
}
