import { useRef, useState, type PointerEvent } from 'react'
import { pixelRegion, regionBetween, type Point, type Region } from './lib/region'
import { EditRequestForm } from './EditRequestForm'

export function RegionPrototype({source, referenceId, direction, navigate}: {source: string; referenceId?: string; direction?: string; navigate?: (path: string) => void}) {
  const image = useRef<HTMLImageElement>(null)
  const start = useRef<Point | null>(null)
  const [region, setRegion] = useState<Region | null>(null)
  const [size, setSize] = useState({width: 0, height: 0})
  const [error, setError] = useState('')
  const [mask, setMask] = useState('')
  function select(region: Region | null) {setRegion(region); setMask('')}
  function point(event: PointerEvent<HTMLDivElement>): Point {
    const box = event.currentTarget.getBoundingClientRect()
    return {x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height}
  }
  const pixels = region && pixelRegion(region, size.width, size.height)
  function makeMask(): string {
    if (!pixels || !pixels.width || !pixels.height) return ''
    try {
      const canvas = document.createElement('canvas')
      canvas.width = size.width; canvas.height = size.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height)
      context.clearRect(pixels.x, pixels.y, pixels.width, pixels.height)
      return canvas.toDataURL('image/png')
    } catch {setError('마스크를 만들지 못했습니다. 이미지 크기와 브라우저를 확인해 주세요.'); return ''}
  }
  function download() {
    const value = makeMask()
    if (!value) return
    const link = document.createElement('a')
    link.download = 'edit-region-mask.png'; link.href = value; link.click()
  }
  return <details className="region-prototype"><summary>영역 편집 준비 · 로컬 실험</summary>
    <p className="hint">이미지를 드래그하거나 아래 숫자로 편집할 영역을 선택하세요. 선택과 마스크 다운로드는 기기에서만 처리되며 AI 요청을 보내지 않습니다.</p>
    <div className="region-stage" onPointerDown={event => {
      if (!size.width || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = point(event); select(regionBetween(start.current, start.current)); setError('')
    }} onPointerMove={event => {if (start.current) select(regionBetween(start.current, point(event)))}}
      onPointerUp={event => {if (start.current) select(regionBetween(start.current, point(event))); start.current = null}}
      onPointerCancel={() => {start.current = null; select(null)}}>
      <img ref={image} src={source} draggable={false} alt="편집 영역을 선택할 이미지" onLoad={() => {
        setSize({width: image.current!.naturalWidth, height: image.current!.naturalHeight})
      }} onError={() => {setSize({width: 0, height: 0}); setError('이미지를 불러오지 못했습니다.')}} />
      {region && <span className="region-selection" style={{left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`}} />}
    </div>
    <fieldset className="region-fields" disabled={!size.width}><legend>선택 영역 (이미지 대비 %)</legend>
      {(['x', 'y', 'width', 'height'] as const).map((key, index) => <label key={key}>{['왼쪽', '위쪽', '너비', '높이'][index]}
        <input type="number" min="0" max="100" step="1" value={Math.round((region?.[key] || 0) * 100)} onChange={event => {
          const value = Number(event.target.value)
          if (!Number.isFinite(value)) return
          const next = {...(region || {x: 0, y: 0, width: 0, height: 0}), [key]: Math.max(0, Math.min(100, value)) / 100}
          next.width = Math.min(next.width, 1 - next.x); next.height = Math.min(next.height, 1 - next.y)
          select(next)
        }} />
      </label>)}
    </fieldset>
    {pixels && <p role="status">선택: {pixels.x}, {pixels.y} · {pixels.width} × {pixels.height}px / 원본 {size.width} × {size.height}px</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <div className="form-actions"><button type="button" className="secondary" disabled={!pixels?.width || !pixels?.height} onClick={download}>마스크 PNG 다운로드</button>
      {referenceId && navigate && <button type="button" className="secondary" disabled={!pixels?.width || !pixels?.height} onClick={() => setMask(makeMask())}>선택 영역 편집 준비</button>}
      <button type="button" className="text-button" onClick={() => {select(null); setError('')}}>선택 초기화</button></div>
    {mask && referenceId && navigate && <EditRequestForm key={mask} source={source} mask={mask} referenceId={referenceId} direction={direction} navigate={navigate} />}
    <p className="hint">마스크는 원본 크기의 PNG이며 선택 영역은 투명, 나머지는 흰색입니다. 실제 영역 편집은 품질 검증 후 제공할 예정입니다.</p>
  </details>
}
