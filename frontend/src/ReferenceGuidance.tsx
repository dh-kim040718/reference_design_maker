import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { api, errorMessage, type Reference, type DesignGuidance, type RegionNote } from './lib/api'

import { guidanceRoles, roleGroups } from './lib/guidanceRoles'
const empty: DesignGuidance = {roles: [], regions: [], image_version: null}

export function GuidanceSummary({value}: {value?: DesignGuidance}) {
  if (!value || (!value.roles.length && !value.regions.length)) return null
  return <div className="guidance-summary">{value.roles.map(role => <span key={role} title={guidanceRoles[role]?.description}>{guidanceRoles[role]?.label || role}</span>)}{value.regions.length > 0 && <span>영역 메모 {value.regions.length}개</span>}</div>
}

export function ReferenceGuidance({reference, onSaved, onDirtyChange}: {reference: Reference; onSaved: () => void; onDirtyChange: (dirty: boolean) => void}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<DesignGuidance>(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [box, setBox] = useState<RegionNote | null>(null)
  const [activeRegion, setActiveRegion] = useState(0)
  const canvas = useRef<HTMLDivElement>(null)
  const transform = useRef<{index: number; kind: string; point: {x: number; y: number}; original: RegionNote} | null>(null)
  const start = useRef<{x: number; y: number} | null>(null)
  const dirty = editing && JSON.stringify(value) !== JSON.stringify(reference.design_guidance || empty)
  useEffect(() => {onDirtyChange(dirty); return () => onDirtyChange(false)}, [dirty, onDirtyChange])
  const stale = value.regions.length > 0 && value.image_version !== reference.preview_version
  function point(event: PointerEvent<HTMLElement>) {
    const rect = canvas.current!.getBoundingClientRect()
    return {x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))}
  }
  function rectangle(a: {x: number; y: number}, b: {x: number; y: number}): RegionNote {
    return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), note: ''}
  }
  function add(region: RegionNote) {setActiveRegion(value.regions.length); setValue(previous => ({...previous, regions: [...previous.regions, region], image_version: reference.preview_version})); setBox(null)}
  function beginTransform(event: PointerEvent<HTMLElement>, index: number, kind: string) {
    event.stopPropagation()
    if (busy || stale || !loaded || event.button !== 0) return
    event.preventDefault(); setActiveRegion(index)
    transform.current = {index, kind, point: point(event), original: {...value.regions[index]}}
    canvas.current!.setPointerCapture(event.pointerId)
  }
  function drag(event: PointerEvent<HTMLDivElement>) {
    const action = transform.current
    if (!action) {if (start.current) setBox(rectangle(start.current, point(event))); return}
    const p = point(event), region = action.original
    let next = {...region}
    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
    if (action.kind === 'move') {
      next.x = clamp(region.x + p.x - action.point.x, 0, 1 - region.width)
      next.y = clamp(region.y + p.y - action.point.y, 0, 1 - region.height)
    } else {
      const left = action.kind.includes('w') ? clamp(p.x, 0, region.x + region.width - .015) : region.x
      const right = action.kind.includes('e') ? clamp(p.x, region.x + .015, 1) : region.x + region.width
      const top = action.kind.includes('n') ? clamp(p.y, 0, region.y + region.height - .015) : region.y
      const bottom = action.kind.includes('s') ? clamp(p.y, region.y + .015, 1) : region.y + region.height
      next = {...region, x: left, y: top, width: right - left, height: bottom - top}
    }
    setValue(previous => ({...previous, regions: previous.regions.map((item, i) => i === action.index ? next : item)}))
  }
  function move(index: number, dx: number, dy: number) {
    setValue(previous => ({...previous, regions: previous.regions.map((region, i) => i !== index ? region : {
      ...region, x: Math.max(0, Math.min(1 - region.width, Number((region.x + dx).toFixed(6)))),
      y: Math.max(0, Math.min(1 - region.height, Number((region.y + dy).toFixed(6)))),
    })}))
  }
  return <section className="reference-guidance"><div className="section-heading"><h2>참고 요소 <span className="optional">선택</span></h2>{!editing && !reference.read_only && <button className="secondary" onClick={() => {setValue(structuredClone(reference.design_guidance || empty)); setEditing(true); setError(''); setLoaded(false)}}>참고 요소 지정</button>}</div>
    {!editing ? <><GuidanceSummary value={reference.design_guidance} />{reference.guidance_stale && <p className="error" role="status">이미지가 변경됐습니다. 참고 영역을 다시 확인해 주세요.</p>}{reference.design_guidance?.regions.map((region, index) => <p className="guidance-region-note" key={index}><strong>영역 {index + 1}</strong> {region.note}</p>)}{!reference.design_guidance?.roles.length && !reference.design_guidance?.regions.length && <p className="hint">기본은 전체 이미지 참고입니다. 원하는 역할이나 특정 영역을 지정할 수 있습니다.</p>}</> : <form onSubmit={async event => {
      event.preventDefault(); if (busy || stale) return
      setBusy(true); setError('')
      try {await api(`/references/${reference.id}`, 'PATCH', {design_guidance: value}); setEditing(false); onSaved()}
      catch (reason) {setError(errorMessage(reason))} finally {setBusy(false)}
    }}>
      <fieldset className="guidance-role-row" disabled={busy}><legend>참고할 특징</legend><div className="guidance-role-groups">{roleGroups.map(group => <div className="guidance-role-group" key={group.name}><span>{group.name}</span><div className="guidance-role-options">{group.roles.map(role => <label key={role} title={guidanceRoles[role].description}><input type="checkbox" checked={value.roles.includes(role)} onChange={event => setValue(previous => ({...previous, roles: event.target.checked ? [...previous.roles, role] : previous.roles.filter(item => item !== role)}))} />{guidanceRoles[role].label}</label>)}</div></div>)}</div><p className="hint">복수 선택 가능 · 미선택 시 전체 참고</p></fieldset>
      <div className="guidance-workspace"><div className="guidance-image-panel"><div className="guidance-panel-heading"><strong>영역 지정</strong><span>{value.regions.length ? '박스 이동 · 모서리로 크기 조절' : '드래그하여 선택'}</span></div>
      {reference.preview_url ? <>
      <div className="guidance-canvas-wrap"><div ref={canvas} className={`guidance-canvas${loaded && !busy && !stale ? ' drawable' : ''}`} onPointerDown={event => {
        if (!loaded || busy || stale || value.regions.length >= 6 || event.button !== 0) return
        start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); setBox({...start.current, width: 0, height: 0, note: ''}); event.preventDefault()
      }} onPointerMove={drag} onPointerUp={event => {
        if (transform.current) {drag(event); transform.current = null; return}
        if (!start.current) return
        const region = rectangle(start.current, point(event)); start.current = null; setBox(null)
        if (region.width >= .015 && region.height >= .015) add(region)
      }} onPointerCancel={() => {if (transform.current) {const action = transform.current; setValue(previous => ({...previous, regions: previous.regions.map((item, i) => i === action.index ? action.original : item)}))} transform.current = null; start.current = null; setBox(null)}}>
        <img src={reference.preview_url} alt="참고 영역 지정용 레퍼런스" draggable={false} onLoad={() => setLoaded(true)} onError={() => {setLoaded(false); setError('이미지를 불러올 수 없습니다. 레퍼런스 이미지를 확인해 주세요.')}} />
        {[...value.regions, ...(box ? [box] : [])].map((region, index) => <span className={`guidance-box${index === activeRegion && index < value.regions.length ? ' active' : ''}`} key={index} onPointerDown={event => {if (index < value.regions.length) beginTransform(event, index, 'move')}} style={{left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%`}}><b>{index + 1}</b>{index === activeRegion && index < value.regions.length && !busy && !stale && (['nw', 'ne', 'sw', 'se'] as const).map(corner => <span key={corner} className={`guidance-resize-handle ${corner}`} aria-hidden="true" onPointerDown={event => beginTransform(event, index, corner)} />)}</span>)}
      </div></div>
      {stale && <div className="notice"><p>이미지가 바뀌었습니다. 영역 위치를 확인한 후 새 이미지에 적용하거나 영역을 삭제해 주세요.</p><button type="button" className="secondary" disabled={busy || !loaded} onClick={() => setValue(previous => ({...previous, image_version: reference.preview_version}))}>새 이미지에서 영역 확인 완료</button></div>}
      </> : <p className="hint">이미지를 저장하면 참고 영역을 지정할 수 있습니다.</p>}</div>
      <div className="guidance-notes-panel"><div className="guidance-panel-heading"><strong>영역 메모 <span>{value.regions.length}/6</span></strong><button type="button" className="text-button" disabled={busy || !loaded || stale || value.regions.length >= 6} onClick={() => add({x: .1, y: .1, width: .4, height: .3, note: ''})}>＋ 영역 추가</button></div>
      {!value.regions.length && <div className="guidance-empty"><span className="guidance-empty-mark" aria-hidden="true">⌖</span><strong>어느 부분을 참고할까요?</strong><p>이미지에 영역을 그리면<br />여기에 메모를 남길 수 있습니다.</p></div>}
      <div className="guidance-region-list">{value.regions.map((region, index) => <fieldset className="guidance-region-editor" disabled={busy} key={index} onFocus={() => setActiveRegion(index)}><legend className="sr-only">영역 {index + 1}</legend><div className="guidance-region-heading"><strong><span>{index + 1}</span> 영역 {index + 1}</strong><button type="button" className="text-button" aria-label={`영역 ${index + 1} 삭제`} onClick={() => setValue(previous => ({...previous, regions: previous.regions.filter((_, i) => i !== index)}))}>삭제</button></div><label><span className="sr-only">참고할 디자인 포인트</span><textarea rows={2} required maxLength={500} value={region.note} placeholder="이 영역에서 참고할 점을 적어 주세요." onChange={event => setValue(previous => ({...previous, regions: previous.regions.map((item, i) => i === index ? {...item, note: event.target.value} : item)}))} /></label>
        <details><summary>정밀 조정</summary>
          <div className="guidance-nudge" role="group" aria-label={`영역 ${index + 1} 이동`}><span>이동</span>{([
            ['왼쪽', '←', -.01, 0], ['위', '↑', 0, -.01], ['아래', '↓', 0, .01], ['오른쪽', '→', .01, 0],
          ] as const).map(([label, arrow, dx, dy]) => <button type="button" className="secondary" key={label} aria-label={`영역 ${index + 1} ${label} 방향으로 이동`} title={`${label} 방향으로 1% 이동`} disabled={busy || (dx < 0 && region.x <= 0) || (dx > 0 && region.x + region.width >= 1) || (dy < 0 && region.y <= 0) || (dy > 0 && region.y + region.height >= 1)} onClick={() => move(index, dx, dy)}>{arrow}</button>)}</div>
          <div className="guidance-coordinates">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{{x: '가로 위치', y: '세로 위치', width: '너비', height: '높이'}[key]} (%)<input className={key === 'x' || key === 'y' ? 'guidance-position-input' : undefined} aria-label={`영역 ${index + 1} ${key}`} type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'width' ? (1 - region.x) * 100 : key === 'height' ? (1 - region.y) * 100 : key === 'x' ? (1 - region.width) * 100 : (1 - region.height) * 100} step="any" value={Math.round(region[key] * 10000) / 100} onChange={event => {const amount = event.target.valueAsNumber / 100; if (Number.isFinite(amount)) setValue(previous => ({...previous, regions: previous.regions.map((item, i) => i === index ? {...item, [key]: amount} : item)}))}} /></label>)}</div>
          <p className="guidance-coordinate-hint">위치 값은 이미지 왼쪽 위 기준입니다. 값이 커지면 오른쪽·아래로 이동합니다.</p>
        </details>
        </fieldset>)}</div></div></div>
      {error && <p className="error" role="alert">{error}</p>}<div className="guidance-footer"><p className="hint">기존 디자인 메모와 함께 반영됩니다.</p><div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => {if (!dirty || window.confirm('수정 중인 참고 요소를 버릴까요?')) {setEditing(false); setError('')}}}>취소</button><button disabled={busy || stale || value.regions.some(region => !region.note.trim())}>{busy ? '저장 중…' : '참고 요소 저장'}</button></div></div>
    </form>}
  </section>
}
