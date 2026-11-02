import { useEffect, useState } from 'react'
import { api, errorMessage } from './lib/api'

interface Metrics {
  total: number; statuses: {succeeded: number; failed: number; unknown: number; queued: number; processing: number}
  operations: {generate: number; edit: number}; latency: {average_ms: number | null}
  usage: {total_tokens: number; known_jobs: number; missing_jobs: number}
}

export function GenerationMetrics() {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(7)
  const [revision, setRevision] = useState(0)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    api<Metrics>(`/generation-metrics?days=${days}`).then(value => {
      if (active) setMetrics(value)
    }).catch(reason => {if (active) setError(errorMessage(reason))})
    return () => {active = false}
  }, [open, days, revision])
  function refresh() {setMetrics(null); setError(''); setRevision(value => value + 1)}
  return <section className="generation-policy" aria-label="내 AI 사용 현황">
    <button type="button" className="text-button" aria-expanded={open} onClick={() => {
      setOpen(value => !value); setMetrics(null); setError('')
    }}>내 AI 사용 현황 {open ? '접기' : '보기'}</button>
    {open && <>
      <label>조회 기간<select value={days} onChange={event => {setDays(Number(event.target.value)); setMetrics(null); setError('')}}>
        <option value={7}>최근 7일</option><option value={30}>최근 30일</option>
      </select></label>
      {error ? <p role="alert" className="error">{error}</p> : !metrics ? <p role="status">사용 현황을 불러오는 중…</p> : <>
        <p>전체 {metrics.total}건 · 전체 생성 {metrics.operations.generate}건 · 영역 편집 {metrics.operations.edit}건</p>
        <p>성공 {metrics.statuses.succeeded}건 · 실패 {metrics.statuses.failed}건 · 결과 확인 필요 {metrics.statuses.unknown}건 · 대기/진행 {metrics.statuses.queued + metrics.statuses.processing}건</p>
        <p>평균 처리 시간: {metrics.latency.average_ms == null ? '측정값 없음' : `${(metrics.latency.average_ms / 1000).toFixed(1)}초`}</p>
        <p>확인된 사용량: {metrics.usage.known_jobs ? `${metrics.usage.total_tokens.toLocaleString()} 토큰` : '제공된 사용량 없음'} · 완료된 요청 중 사용량 미제공 {metrics.usage.missing_jobs}건</p>
      </>}
      <p className="hint">내 계정의 UTC 날짜 기준 기록이며 삭제한 결과도 포함합니다. 요청 기록은 실제 과금 횟수와 다를 수 있습니다. 실제 청구액은 제공자 사용 내역에서 확인해 주세요.</p>
      <button type="button" className="secondary" onClick={refresh}>사용 현황 새로고침</button>
    </>}
  </section>
}
