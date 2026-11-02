import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage } from './lib/api'

export function EditRequestForm({source, mask, referenceId, direction = '', navigate}: {
  source: string; mask: string; referenceId: string; direction?: string; navigate: (path: string) => void
}) {
  const [policy, setPolicy] = useState<{editing_enabled?: boolean; remaining: number} | null>(null)
  const [existingDirection, setDirection] = useState(direction)
  const [instruction, setInstruction] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ambiguous, setAmbiguous] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  useEffect(() => {
    let active = true
    api<{editing_enabled?: boolean; remaining: number}>('/generation-policy').then(value => {
      if (active) setPolicy(value)
    }).catch(reason => {if (active) setError(errorMessage(reason))})
    return () => {active = false}
  }, [])
  function changed() {requestId.current = crypto.randomUUID(); setError('')}
  return <form className="edit-request-form" onSubmit={async event => {
    event.preventDefault()
    if (busy || !policy?.editing_enabled || !policy.remaining || !rights) return
    setBusy(true); setError('')
    try {
      const job = await api<{id: string}>(`/references/${referenceId}/edits`, 'POST', {
        request_id: requestId.current, source_image: source, mask_image: mask,
        direction: existingDirection, instruction, rights_confirmed: rights,
      })
      navigate(`/generations/${job.id}`)
    } catch (reason) {
      setAmbiguous(!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500)
      setError(errorMessage(reason) + ' 입력을 유지한 채 다시 누르면 같은 요청을 확인합니다. 새로고침 후에는 생성 이력을 먼저 확인해 주세요.')
    } finally {setBusy(false)}
  }}>
    <h3>영역 편집 요청 준비</h3>
    <p className="hint">현재 선택한 이미지와 마스크로 한 번 편집합니다. 준비만으로는 AI 요청을 보내지 않습니다.</p>
    <label>유지할 디자인 방향<textarea maxLength={5000} rows={3} value={existingDirection} disabled={busy || ambiguous} onChange={event => {changed(); setDirection(event.target.value)}} /></label>
    <label>선택 영역 편집 지시 (선택)<textarea maxLength={2000} rows={3} value={instruction} disabled={busy || ambiguous} onChange={event => {changed(); setInstruction(event.target.value)}} placeholder="비워두면 기존 방향을 유지하며 선택 영역 안에서 변형합니다." /></label>
    <label className="rights-check"><input type="checkbox" checked={rights} disabled={busy || ambiguous} onChange={event => setRights(event.target.checked)} /><span>이 이미지를 AI 편집 입력으로 사용할 권한을 확인했습니다.</span></label>
    {!policy?.editing_enabled && <p className="notice">영역 편집 연동·품질 검증 대기 중입니다. 현재 편집 요청은 전송할 수 없습니다.</p>}
    <p className="hint">활성화 후에는 편집도 별도 비용과 하루 생성 횟수에 포함됩니다. 결과 불명 시 자동 재시도하지 않습니다.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button disabled={busy || !policy?.editing_enabled || !policy.remaining || !rights}>{busy ? '요청 중…' : ambiguous ? '같은 편집 요청 상태 확인' : '선택 영역 1회 편집'}</button>
  </form>
}
