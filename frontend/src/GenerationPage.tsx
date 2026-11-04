import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage, type Reference } from './lib/api'
import { RegionPrototype } from './RegionPrototype'
import { GenerationMetrics } from './GenerationMetrics'
import { GuidanceSummary } from './ReferenceGuidance'
import type { DesignGuidance } from './lib/api'

interface Policy {enabled: boolean; remaining: number; daily_limit: number; model: string; reason?: string}
interface Job {id: string; reference_id: string | null; project_id?: string | null; scope?: string; status: string; operation?: string; direction?: string; instruction: string; note_snapshot: string; result_image?: string | null; error_code?: string; provider_reason?: string | null; elapsed_ms?: number; usage?: {total_tokens?: number}; project_snapshot?: {type_id?: string; project_name: string; brief: string; references: {id: string; title: string; type_name: string; design_note: string; design_guidance?: DesignGuidance}[]}}
const labels: Record<string, string> = {queued: '생성 대기 중', processing: 'AI 시안 생성 중…', succeeded: '생성 완료', failed: '생성 실패', unknown: '결과 확인 필요'}
const diagnosticMessages: Record<string, string> = {
  authentication: '서버의 AI 인증 설정을 확인해야 합니다.',
  permission: 'AI 기능 사용 권한을 확인해야 합니다.',
  model_unavailable: '설정된 AI 모델의 사용 가능 여부를 확인해야 합니다.',
  quota: 'AI 제공자의 결제 잔액 또는 사용 한도를 확인해야 합니다.',
  rate_limit: 'AI 제공자의 요청 제한에 도달했습니다.',
  invalid_request: 'AI 제공자가 입력 형식을 허용하지 않았습니다.',
  safety: 'AI 제공자의 콘텐츠 정책에 따라 요청이 차단됐습니다.',
  upstream: 'AI 제공자 서버에서 오류가 발생했습니다.',
  timeout: 'AI 응답을 기다리다 제한 시간을 초과했습니다.',
  connection: 'AI 제공자와 연결하지 못했습니다.',
}
const policyMessages: Record<string, string> = {
  budget_unconfigured: 'AI 사용 예산 설정 대기',
  billing_reconciliation_required: '이전 AI 사용 내역 확인 필요',
  budget_exhausted: 'AI 사용 예산 한도 도달',
  budget_ledger_inconsistent: 'AI 예산 기록 확인 필요',
  key_missing: 'AI 연결 설정 대기',
}

export function GenerationPage({referenceId, jobId, fromJobId, navigate}: {referenceId?: string; jobId?: string; fromJobId?: string; navigate: (path: string) => void}) {
  const [reference, setReference] = useState<Reference | null>(null)
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [previous, setPrevious] = useState<Job | null>(null)
  const [source, setSource] = useState('')
  const [instruction, setInstruction] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(crypto.randomUUID())
  const [ambiguous, setAmbiguous] = useState(false)
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        if (jobId) {
          const value = await api<Job>(`/generations/${jobId}`)
          if (!active) return
          setJob(value)
          if (['queued', 'processing'].includes(value.status)) timer = setTimeout(load, 2000)
        } else if (referenceId) {
          const [ref, config, history] = await Promise.all([
            api<Reference>(`/references/${referenceId}`), api<Policy>('/generation-policy'),
            api<{items: Job[]}>(`/references/${referenceId}/generations`),
          ])
          if (fromJobId) {
            const prior = await api<Job>(`/generations/${encodeURIComponent(fromJobId)}`)
            if (prior.reference_id !== referenceId || prior.status !== 'succeeded') throw new Error('완료된 동일 레퍼런스의 시안만 재생성할 수 있습니다.')
            if (active) {setPrevious(prior); setInstruction(prior.instruction || '')}
          }
          if (active) {setReference(ref); setPolicy(config); setJobs(history.items)}
        }
      } catch (reason) {if (active) setError(errorMessage(reason))}
    }
    void load()
    return () => {active = false; clearTimeout(timer)}
  }, [referenceId, jobId, fromJobId])

  function changed() {request.current = crypto.randomUUID(); setAmbiguous(false); setError('')}
  async function selectFile(file?: File) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setError('PNG·JPEG·WebP 원본 이미지(8MB 이하)를 선택해 주세요.'); return
    }
    const reader = new FileReader()
    reader.onerror = () => setError('이미지를 읽지 못했습니다.')
    reader.onload = () => {changed(); setSource(String(reader.result))}
    reader.readAsDataURL(file)
  }
  const backId = job?.reference_id || referenceId
  const projectPath = job?.project_id ? `/projects/${job.project_id}/generate${job.project_snapshot?.type_id ? `?type=${encodeURIComponent(job.project_snapshot.type_id)}` : ''}` : null
  const returnPath = projectPath || `/references/${backId}/generate`
  const activeJob = jobs.find(item => ['queued', 'processing'].includes(item.status))
  return <section className={`generation-workspace${jobId ? ' generation-result-page' : ''}`}>
    <div className="workspace-heading"><button className="text-button" onClick={() => navigate(projectPath || `/references/${backId}`)}>{projectPath ? '← 프로젝트 시안으로' : '← 레퍼런스로'}</button><span className="ai-badge">{jobId && job?.scope === 'reference' ? '과거 단일 참고 시안' : 'AI 탐색 시안'}</span></div>
    <div className="generation-page-heading"><h1>{jobId ? '생성 결과' : '레퍼런스에서 새로운 시안 만들기'}</h1><GenerationMetrics /></div>
    <p className="hint">{job?.scope === 'project' ? `선택한 레퍼런스 ${job.project_snapshot?.references.length ?? ''}개와 메모를 참고한 AI 탐색 시안입니다.` : jobId && job?.scope === 'reference' ? '과거 단일 레퍼런스의 AI 탐색 시안입니다.' : '전체 이미지와 디자인 메모를 참고한 탐색용 이미지입니다.'}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {jobId ? job && <article className="generation-result">
      <div className="section-heading"><h2 role="status">{labels[job.status] || job.status}</h2><span>AI 생성 이미지</span></div>
      {['queued', 'processing'].includes(job.status) && <p>이 화면을 나가도 작업은 계속됩니다. 잠시 후 생성 이력에서 다시 확인할 수 있습니다.</p>}
      {['failed', 'unknown'].includes(job.status) && <p role="alert">{job.status === 'unknown' ? '요청이 전달되었을 수 있어 자동 재시도하지 않습니다. 비용과 제공자 상태를 확인해 주세요.' : '이미지를 생성하지 못했습니다. 입력과 API 설정을 확인해 주세요.'} 이 요청도 하루 사용 횟수에 포함됩니다.</p>}
      {['failed', 'unknown'].includes(job.status) && job.provider_reason && diagnosticMessages[job.provider_reason] && <p className="notice">{diagnosticMessages[job.provider_reason]}</p>}
      <div className="generation-output-layout"><div className="generation-output-preview">
      {job.result_image ? <div className="generation-image-stage"><img className="generated-image" src={job.result_image} alt="AI가 생성한 탐색 시안" /></div> : <div className="generation-image-stage generation-image-pending"><p>{labels[job.status]}<br /><span>완료되면 이곳에 시안이 표시됩니다.</span></p></div>}
      {job.result_image && job.reference_id && <RegionPrototype key={job.id} source={job.result_image} referenceId={job.reference_id} direction={job.direction || job.note_snapshot} navigate={navigate} />}
      </div><aside className="generation-output-sidebar" aria-label="시안 정보와 작업">
      {job.operation === 'edit' && <div className="generation-notes"><h3>영역 편집 · 유지할 디자인 방향</h3><p>{job.direction || '저장된 메모의 방향 유지'}</p></div>}
      {job.project_snapshot && <div className="generation-result-summary"><strong>{job.project_snapshot.project_name}</strong><p className="generation-brief-excerpt" title={job.project_snapshot.brief}>{job.project_snapshot.brief}</p><span>참고 레퍼런스 {job.project_snapshot.references.length}개</span></div>}
      {(job.result_image || job.status === 'succeeded') && <div className="generation-primary-actions">{job.result_image && <a className="button" href={job.result_image} download={`ai-concept-${job.id}.png`}>AI 시안 다운로드</a>}
        {job.status === 'succeeded' && <button type="button" className="text-button" title="입력과 조건을 검토하는 화면으로 이동합니다" onClick={() => navigate(projectPath ? job.scope === 'project' ? `${projectPath}${projectPath.includes('?') ? '&' : '?'}from=${encodeURIComponent(job.id)}` : projectPath : `/references/${job.reference_id}/generate?from=${encodeURIComponent(job.id)}`)}>{job.scope === 'reference' && projectPath ? '프로젝트 전체 시안 만들기' : '다른 시안 만들기 →'}</button>}
      </div>}
      {job.project_snapshot && <details className="generation-notes"><summary>입력 내용 자세히</summary><h3>프로젝트 요구사항</h3><p>{job.project_snapshot.brief}</p><h3>검토한 레퍼런스 {job.project_snapshot.references.length}개</h3>{job.project_snapshot.references.map((row, index) => <div className="concept-snapshot-note" key={row.id}><strong>{index + 1}. {row.title} · {row.type_name}</strong><p>{row.design_note || '메모 없이 이미지 참고'}</p><GuidanceSummary value={row.design_guidance} />{row.design_guidance?.regions.map((region, i) => <p key={i}>영역 {i + 1} · {region.note}</p>)}</div>)}</details>}
      {(!job.project_snapshot || job.instruction) && <details className="generation-notes"><summary>{job.project_snapshot ? '추가 요청' : '생성에 사용한 메모'}</summary>{!job.project_snapshot && <p>{job.note_snapshot || '메모 없이 전체 이미지 참고'}</p>}{job.instruction && <p>{job.instruction}</p>}</details>}
      {job.elapsed_ms != null && <details className="generation-notes"><summary>생성 정보</summary><p>처리 시간 {(job.elapsed_ms / 1000).toFixed(1)}초<br />사용량 {job.usage?.total_tokens != null ? `${job.usage.total_tokens} 토큰` : '제공자 사용량 미제공'}</p><p className="hint">실제 청구액은 제공자 사용 내역에서 확인해 주세요.</p></details>}
      {!['queued', 'processing'].includes(job.status) && <button className="text-button generation-result-delete" disabled={busy} onClick={async () => {
        if (!window.confirm('비공개 생성 결과를 삭제할까요?')) return
        setBusy(true)
        try {await api(`/generations/${job.id}`, 'DELETE'); navigate(returnPath)}
        catch (reason) {setError(errorMessage(reason)); setBusy(false)}
      }}>결과 삭제</button>}
      </aside></div>
    </article> : reference && policy ? <>
      {previous && <div className="notice"><strong>새 요청으로 전체 재생성</strong><p>이전 추가 요청을 가져왔습니다. 저장된 현재 메모를 확인하고 원본 이미지를 다시 선택해 주세요. 생성 버튼을 누르면 별도의 사용 횟수와 비용이 발생하며 이전 결과는 유지됩니다.</p><p>이전 생성 메모: {previous.note_snapshot || '메모 없음'}</p></div>}
      <div className="generation-layout"><div className="generation-source"><h2>참고할 전체 이미지</h2>
        {source ? <img src={source} alt="생성에 사용할 전체 참조 이미지" /> : <div className="generation-empty">원본 이미지를 선택해 주세요</div>}
        <label className="image-file-label">원본 이미지 선택<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || ambiguous} onChange={event => void selectFile(event.target.files?.[0])} /></label>
        <p className="hint">8MB·1,600만 화소 이하. 원본은 생성 요청에만 임시 사용하며 서버에 보관하지 않습니다.</p>
        {reference.preview_url?.startsWith('data:image/') && <button className="secondary" disabled={busy || ambiguous} onClick={() => {changed(); setSource(reference.preview_url!)}}>저장된 미리보기 사용</button>}
        <p className="hint">저장된 미리보기는 축소 이미지여서 원본보다 품질이 낮을 수 있습니다.</p>
        {source && <RegionPrototype key={source} source={source} referenceId={reference.id} direction={reference.design_note || ''} navigate={navigate} />}
      </div><form onSubmit={async event => {
        event.preventDefault(); if (busy || activeJob) return
        setBusy(true); setError('')
        try {
          const created = await api<Job>(`/references/${referenceId}/generations`, 'POST', {request_id: request.current, source_image: source, instruction, rights_confirmed: rights})
          navigate(`/generations/${created.id}`)
        } catch (reason) {setAmbiguous(!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500); setError(errorMessage(reason) + ' 입력을 유지한 채 다시 누르면 같은 요청을 확인합니다. 새로고침 후에는 아래 생성 이력을 먼저 확인해 주세요.')}
        finally {setBusy(false)}
      }}><h2>{reference.title || '새 시안'}</h2><div className="generation-notes"><h3>저장된 디자인 메모</h3><p>{reference.design_note || '메모 없이도 생성할 수 있어요.'}</p></div>
        <label>추가 요청 <span className="hint">선택</span><textarea maxLength={2000} rows={4} value={instruction} disabled={busy || ambiguous} onChange={event => {changed(); setInstruction(event.target.value)}} placeholder="예: 여백을 넓히고 밝은 색감으로 구성해 주세요." /></label>
        <label className="rights-check"><input type="checkbox" checked={rights} disabled={busy || ambiguous} onChange={event => setRights(event.target.checked)} /><span>이 이미지를 AI 생성 입력으로 사용할 권한을 확인했습니다.</span></label>
        <div className="generation-policy"><strong>{policy.enabled ? `오늘 남은 생성 ${policy.remaining} / ${policy.daily_limit}회` : policyMessages[policy.reason || ''] || '유료 API 사용 승인 대기'}</strong><p>한 번에 1장 · 1024 × 1024 · 낮은 품질 설정</p><p className="hint">텍스트 입력 $5·이미지 입력 $8·출력 $30 / 각 100만 토큰. 실제 비용은 사용량에 따라 달라집니다. 하루 한도는 모든 계정 합계이며 실패·응답 불명 요청도 포함합니다.</p><p className="hint">서버 예산을 미리 예약하며 실패·결과 불명·삭제 시 자동 반환하지 않습니다. 예약액은 실제 청구액과 다릅니다.</p></div>
        {!policy.enabled && <p className="notice">모델과 비용 한도 승인 후 서버에서 활성화합니다. 지금은 비용이 발생하지 않습니다.</p>}
        {activeJob ? <button type="button" onClick={() => navigate(`/generations/${activeJob.id}`)}>진행 중인 생성 확인</button> : <button disabled={busy || !policy.enabled || !policy.remaining || !source || !rights || reference.read_only}>{busy ? '요청 중…' : ambiguous ? '같은 요청 상태 확인' : 'AI 시안 1장 생성'}</button>}
      </form></div>
      <section className="generation-history"><h2>생성 이력</h2>{!jobs.length && <p className="hint">아직 생성한 시안이 없습니다.</p>}{jobs.map(item => <button className="secondary" key={item.id} onClick={() => navigate(`/generations/${item.id}`)}>{item.operation === 'edit' ? '영역 편집 · ' : ''}{labels[item.status]} · {item.instruction || '전체 이미지 참고'} →</button>)}</section>
    </> : !error && <p role="status">불러오는 중…</p>}
  </section>
}
