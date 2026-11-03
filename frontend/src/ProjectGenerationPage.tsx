import { useEffect, useRef, useState } from 'react'
import { api, ApiError, errorMessage, type Reference } from './lib/api'
import { GenerationMetrics } from './GenerationMetrics'
import { ProjectHeader } from './ProjectHeader'

interface InputReference {
  id: string; title: string; source_url: string; design_note: string; type_name: string
  archived_type: boolean; preview_url: string | null; thumbnail_url?: string | null; preview_version?: string
}
interface Context {
  type_id?: string; type_name?: string
  project_id: string; project_name: string; brief: string; references: InputReference[]
  total: number; context_digest: string; blocked_reason: string; max_references: number
  read_only: boolean; prompt_characters: number
}
interface Policy {enabled: boolean; reason?: string; remaining: number; daily_limit: number}
interface ImageIssue {message: string; retryable: boolean; stale?: boolean}
function imageIssue(reason: unknown): ImageIssue {
  const retryable = !(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500
  return {message: retryable && (!(reason instanceof ApiError) || reason.code !== 'IMAGE_DOWNLOAD_FAILED')
    ? '이미지 준비 중 앱 서버 오류가 발생했습니다. 이미지를 바꾸지 않고 다시 준비할 수 있습니다.' : errorMessage(reason),
    retryable, stale: reason instanceof ApiError && reason.code === 'PREVIEW_CHANGED'}
}
interface HistoryJob {id: string; scope: string; status: string; instruction: string; note_snapshot: string; project_id: string; project_snapshot?: {selected_reference_ids?: string[]}}
const labels: Record<string, string> = {queued: '대기', processing: '생성 중', succeeded: '완료', failed: '실패', unknown: '결과 확인 필요'}
const policyLabels: Record<string, string> = {budget_unconfigured: 'AI 예산 설정 대기', budget_exhausted: 'AI 예산 한도 도달', billing_reconciliation_required: '이전 사용 내역 확인 필요', budget_ledger_inconsistent: '예산 기록 확인 필요', key_missing: 'AI 연결 설정 대기', approval_required: '유료 API 사용 승인 대기'}
const sourceBytes = (value: string) => {const encoded = value.split(',')[1] || ''; return encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)}

export function LegacyGenerationRedirect({referenceId, navigate}: {referenceId: string; navigate: (path: string) => void}) {
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api<Reference>(`/references/${referenceId}`).then(ref => {if (active) navigate(`/projects/${ref.project_id}/generate`)}).catch(reason => {if (active) setError(errorMessage(reason))})
    return () => {active = false}
  }, [referenceId, navigate])
  return error ? <p role="alert" className="error">{error}</p> : <p role="status">프로젝트 전체 시안 화면으로 이동 중…</p>
}

export function ProjectGenerationPage({projectId, fromJobId, typeId, navigate, onDirtyChange}: {
  projectId: string; fromJobId?: string; typeId?: string; navigate: (path: string) => void; onDirtyChange?: (dirty: boolean) => void
}) {
  const contextPath = `/projects/${projectId}/generation-context${typeId ? `?type_id=${encodeURIComponent(typeId)}` : ''}`
  const [context, setContext] = useState<Context | null>(null)
  const [brief, setBrief] = useState('')
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [history, setHistory] = useState<HistoryJob[]>([])
  const [sources, setSources] = useState<Record<string, string>>({})
  const [imageErrors, setImageErrors] = useState<Record<string, ImageIssue>>({})
  const [preparing, setPreparing] = useState(false)
  const [excludedIds, setExcludedIds] = useState<string[]>([])
  const [instruction, setInstruction] = useState('')
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ambiguous, setAmbiguous] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef(crypto.randomUUID())
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [input, config, jobs] = await Promise.all([
          api<Context>(contextPath),
          api<Policy>('/generation-policy'),
          api<{items: HistoryJob[]}>(`/projects/${projectId}/generations`),
        ])
        if (!active) return
        setContext(input); setBrief(input.brief); setPolicy(config); setHistory(jobs.items)
        if (fromJobId) {
          const previous = await api<HistoryJob>(`/generations/${encodeURIComponent(fromJobId)}`)
          if (!active) return
          if (previous.scope !== 'project' || previous.project_id !== projectId) throw new Error('이 프로젝트의 시안만 재생성할 수 있습니다.')
          setInstruction(previous.instruction || '')
          const chosen = previous.project_snapshot?.selected_reference_ids
          if (chosen) setExcludedIds(input.references.filter(row => !chosen.includes(row.id)).map(row => row.id))
          setNotice('이전 추가 요청과 레퍼런스 선택을 가져왔습니다. 현재 입력을 확인해 새 시안을 만드세요. 이전 결과는 유지됩니다.')
        }
      } catch (reason) {if (active) setError(errorMessage(reason))}
    }
    void load()
    return () => {active = false}
  }, [projectId, fromJobId, contextPath])
  const dirty = !!context && (brief !== context.brief || !!instruction || Object.keys(sources).length > 0 || excludedIds.length > 0)
  useEffect(() => {
    onDirtyChange?.(dirty)
    const warn = (event: BeforeUnloadEvent) => {if (dirty) {event.preventDefault(); event.returnValue = ''}}
    window.addEventListener('beforeunload', warn)
    return () => {onDirtyChange?.(false); window.removeEventListener('beforeunload', warn)}
  }, [dirty, onDirtyChange])
  function changed() {request.current = crypto.randomUUID(); setError(''); setNotice('')}
  const locked = busy || ambiguous || !!context?.read_only
  const selectedReferences = context?.references.filter(row => !excludedIds.includes(row.id)) || []
  const totalBytes = selectedReferences.reduce((sum, row) => sum + sourceBytes(sources[row.id] || ''), 0)
  const tooLarge = totalBytes > 16 * 1024 * 1024
  const promptTooLong = !!context && context.prompt_characters - context.brief.length + brief.length + instruction.length > 32000
  const activeJob = history.find(job => ['queued', 'processing'].includes(job.status))
  async function readSource(row: InputReference) {
    if (row.preview_url?.startsWith('data:image/')) return row.preview_url
    return (await api<{image: string}>(`/references/${row.id}/generation-source${row.preview_version ? `?version=${encodeURIComponent(row.preview_version)}` : ''}`)).image
  }
  async function retryImage(row: InputReference) {
    if (locked) return
    setBusy(true); setPreparing(true); setError(''); setNotice('')
    try {
      const image = await readSource(row)
      setSources(previous => ({...previous, [row.id]: image}))
      setImageErrors(previous => {const next = {...previous}; delete next[row.id]; return next})
      setNotice('이미지가 준비됐습니다. 시안 만들기를 누르면 이어서 진행합니다.')
    } catch (reason) {setImageErrors(previous => ({...previous, [row.id]: imageIssue(reason)}))}
    finally {setBusy(false); setPreparing(false)}
  }
  async function selectFile(id: string, file?: File) {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {setError('PNG·JPEG·WebP 이미지(각 8MB 이하)를 선택해 주세요.'); return}
    const reader = new FileReader()
    reader.onerror = () => setError('이미지를 읽지 못했습니다.')
    reader.onload = () => {changed(); setSources(previous => ({...previous, [id]: String(reader.result)})); setImageErrors(previous => {const next = {...previous}; delete next[id]; return next})}
    reader.readAsDataURL(file)
  }
  if (!context || !policy) return error ? <p className="error" role="alert">{error}</p> : <p role="status">프로젝트 입력을 불러오는 중…</p>
  return <section className="project-concepts">
    <ProjectHeader projectId={projectId} typeId={typeId} name={context.project_name} active="generation" count={context.total} navigate={navigate} />
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {context.read_only && <p className="notice">보관된 프로젝트입니다. 입력과 이력은 확인할 수 있으며 새 시안은 만들 수 없습니다.</p>}
    <section className="concept-brief"><h2>2. 프로젝트 요구사항</h2>
      <label>어떤 디자인을 만들까요?<textarea rows={3} maxLength={5000} value={brief} disabled={locked} onChange={event => {changed(); setBrief(event.target.value)}} placeholder="만들 화면, 핵심 기능, 원하는 분위기를 적어 주세요." /></label>
      <p className="hint">우선순위: 추가 요청 → 프로젝트 요구사항 → 메모</p>
    </section>
    <section className="concept-inputs"><div className="section-heading"><h2>1. {context.type_name ? `${context.type_name} 분류 레퍼런스` : '검토할 전체 레퍼런스'} · {context.total}개</h2>
      <button className="secondary" disabled={busy || ambiguous} onClick={async () => {
        setBusy(true)
        try {
          const [latest, config, jobs] = await Promise.all([
            api<Context>(contextPath), api<Policy>('/generation-policy'),
            api<{items: HistoryJob[]}>(`/projects/${projectId}/generations`),
          ])
          setContext(latest); setPolicy(config); setHistory(jobs.items); changed()
          setNotice('전체 레퍼런스와 메모를 다시 확인했습니다. 입력 이미지는 같은 레퍼런스에 한해 유지됩니다.')
        } catch (reason) {setError(errorMessage(reason))} finally {setBusy(false)}
      }}>프로젝트 입력 새로고침</button>
      </div>
      <div className="concept-selection-toolbar">
        <label><input type="checkbox" aria-label="레퍼런스 전체 선택" checked={context.references.length > 0 && selectedReferences.length === context.references.length} ref={node => {if (node) node.indeterminate = selectedReferences.length > 0 && selectedReferences.length < context.references.length}} disabled={locked || !context.references.length} onChange={event => {changed(); setExcludedIds(event.target.checked ? [] : context.references.map(row => row.id))}} />전체 선택</label>
        <button type="button" className="text-button" disabled={locked || !selectedReferences.length} onClick={() => {changed(); setExcludedIds(context.references.map(row => row.id))}}>전체 해제</button>
        <span role="status" aria-live="polite">{selectedReferences.length} / {context.total}개 선택</span>
      </div>
      {context.blocked_reason === 'reference_limit' && <p className="notice">레퍼런스 {context.total}개 전체를 현재 한 번에 검토할 수 없습니다(최대 {context.max_references}개). 일부만 자동 선택하지 않습니다. 프로젝트 범위를 정리한 뒤 다시 확인해 주세요.</p>}
      {context.blocked_reason === 'no_references' && <p className="notice">프로젝트에 레퍼런스를 먼저 추가해 주세요.</p>}
      <div className="concept-reference-grid">{context.references.map((row, index) => <article className={`concept-reference ${excludedIds.includes(row.id) ? 'is-excluded' : 'is-selected'}`} key={row.id}>
        <label className="concept-card-select"><input type="checkbox" aria-label={`${row.title} 참고 이미지 선택`} checked={!excludedIds.includes(row.id)} disabled={locked} onChange={event => {changed(); setExcludedIds(previous => event.target.checked ? previous.filter(id => id !== row.id) : [...previous, row.id])}} /><span className="sr-only">참고 이미지 선택</span></label>
        <div className="concept-reference-main">
        <div className="concept-image">{sources[row.id] || row.thumbnail_url || row.preview_url ? <img src={sources[row.id] || row.thumbnail_url || row.preview_url!} referrerPolicy="no-referrer" alt={`${row.title} ${sources[row.id] ? '생성 입력' : '저장된 미리보기'}`} /> : <p>저장된 미리보기 이미지가 없습니다.</p>}</div>
        <div className="concept-reference-info">
          <button className="concept-reference-title" title={`${row.title} · 레퍼런스와 메모 확인`} disabled={locked} onClick={() => navigate(`/references/${row.id}`)}>{index + 1}. {row.title}</button>
          {!context.type_id && <span className="concept-reference-type">{row.type_name}{row.archived_type ? ' · 보관됨' : ''}</span>}
        </div></div>
        <p className="concept-note" title={row.design_note || '메모 없음'}>{row.design_note || '메모 없음'}</p>
        {!excludedIds.includes(row.id) && imageErrors[row.id] && <div className="concept-image-recovery"><p role="alert">{imageErrors[row.id].message}</p>
          {imageErrors[row.id].retryable ? <button type="button" className="secondary" disabled={locked} onClick={() => void retryImage(row)}>이미지 다시 준비</button>
            : !imageErrors[row.id].stale && <label className="concept-upload">이미지 교체<input aria-label={`${row.title} 이미지 교체`} type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={event => void selectFile(row.id, event.target.files?.[0])} /></label>}
        </div>}
      </article>)}</div>
      <details className="concept-help"><summary>이미지 규격·보관 안내</summary><p className="hint">각 8MB·1,600만 화소 이하, 전체 합계 16MB 이하. 저장된 이미지 주소에서 생성 입력을 준비하며 원본은 서버에 보관하지 않습니다. 이미지를 가져올 수 없을 때만 교체가 필요합니다.</p></details>
    </section>
    <form className="concept-submit" onSubmit={async event => {
      event.preventDefault()
      if (busy || activeJob || !policy.enabled || !selectedReferences.length || tooLarge || promptTooLong || !rights || !brief.trim() || context.blocked_reason || context.read_only) return
      setBusy(true); setError('')
      let submitted = false
      try {
        setPreparing(true)
        const prepared = {...sources}
        const failures: Record<string, ImageIssue> = {}
        for (const row of selectedReferences) {
          if (prepared[row.id]) continue
          try {
            prepared[row.id] = await readSource(row)
          } catch (reason) {failures[row.id] = imageIssue(reason)}
        }
        setSources(prepared); setImageErrors(failures); setPreparing(false)
        if (Object.keys(failures).length) {setError('이미지 준비가 완료되지 않았습니다. 카드의 오류 안내를 확인해 주세요. 유료 생성은 실행하지 않았습니다.'); return}
        if (selectedReferences.reduce((sum, row) => sum + sourceBytes(prepared[row.id]), 0) > 16 * 1024 * 1024) {
          setImageErrors(Object.fromEntries(selectedReferences.map(row => [row.id, {message: '전체 합계가 16MB를 초과했습니다. 더 작은 이미지로 교체할 수 있습니다.', retryable: false}])))
          setError('입력 이미지 합계가 16MB를 초과했습니다.'); return
        }
        submitted = true
        const job = await api<{id: string}>(`/projects/${projectId}/generations`, 'POST', {
          request_id: request.current, context_digest: context.context_digest,
          ...(typeId ? {type_id: typeId} : {}),
          brief,
          selected_reference_ids: selectedReferences.map(row => row.id),
          sources: selectedReferences.map(row => ({reference_id: row.id, image: prepared[row.id]})), instruction, rights_confirmed: rights,
        })
        onDirtyChange?.(false); navigate(`/generations/${job.id}`)
      } catch (reason) {
        setAmbiguous(submitted && (!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500))
        setError(errorMessage(reason) + ' 연결 결과가 불명확하면 입력을 유지한 채 같은 요청 상태를 확인하세요. 새로고침 전 이력을 확인해 주세요.')
      } finally {setBusy(false); setPreparing(false)}
    }}><h2>3. 시안생성</h2>
      <label>추가 요청 (선택)<textarea rows={2} maxLength={2000} value={instruction} disabled={locked} onChange={event => {changed(); setInstruction(event.target.value)}} placeholder="이번 시안에 더 반영할 내용을 적어 주세요." /></label>
      <div className="generation-policy"><strong>{policy.enabled ? `오늘 남은 생성 ${policy.remaining} / ${policy.daily_limit}회` : policyLabels[policy.reason || ''] || '유료 API 사용 승인 대기'}</strong>
        <p>선택한 레퍼런스 {selectedReferences.length}개 · 이미지와 메모 자동 반영</p>
        <p className="hint">이미지 수에 따라 비용이 달라집니다. 실제 청구액은 제공자 사용 내역에서 확인하세요.</p></div>
      {(context.blocked_reason === 'prompt_limit' || promptTooLong) && <p className="notice">전체 요구사항·메모·추가 요청의 길이가 입력 한도를 초과했습니다. 일부 메모를 조용히 생략하지 않습니다.</p>}
      {tooLarge && <p className="notice">전체 이미지 합계가 16MB를 초과했습니다. 더 작은 이미지를 선택해 주세요.</p>}
      {!selectedReferences.length && <p className="hint" role="status">참고할 레퍼런스를 한 개 이상 선택해 주세요.</p>}
      <label className="rights-check"><input type="checkbox" checked={rights} disabled={locked} onChange={event => setRights(event.target.checked)} /><span>프로젝트의 모든 입력 이미지를 AI 생성에 사용할 권한을 확인했습니다.</span></label>
      {!policy.enabled && <p className="hint" role="status">{policy.reason === 'budget_exhausted'
        ? '앱의 API 예산 제한으로 생성이 잠겨 있습니다. 체크 여부와 관계없이 새 요청을 보낼 수 없습니다. 실제 청구액과 앱의 예약 예산은 다를 수 있으며, 사용 내역 확인 후 서버 예산 설정을 조정해야 합니다.'
        : `${policyLabels[policy.reason || ''] || 'AI 사용 제한'} 상태여서 생성할 수 없습니다. 서버의 AI 사용 설정을 확인해 주세요.`}</p>}
      {activeJob ? <button type="button" onClick={() => navigate(`/generations/${activeJob.id}`)}>진행 중인 요청 확인</button> : <button disabled={busy || !selectedReferences.length || !policy.enabled || !policy.remaining || tooLarge || promptTooLong || !rights || !brief.trim() ||  !!context.blocked_reason || context.read_only}>{busy ? (preparing ? '이미지 준비 중…' : '요청 중…') : ambiguous ? '같은 프로젝트 요청 상태 확인' : context.type_name ? '이 분류 시안 1장 만들기' : '프로젝트 시안 1장 만들기'}</button>}
    </form>
    <details id="history" open={window.location.hash === '#history' || undefined} className="generation-history"><summary>프로젝트 시안 이력 · {history.length}개</summary><p className="hint">최근 100개 · 과거 단일 참고 시안은 프로젝트 종합 결과와 구분합니다.</p>
      {!history.length && <p className="hint">아직 생성한 프로젝트 시안이 없습니다.</p>}
      {history.map(job => <button className="secondary" key={job.id} onClick={() => navigate(`/generations/${job.id}`)}>{job.scope === 'project' ? '프로젝트 종합 시안' : '과거 단일 참고 시안'} · {labels[job.status]} · {job.instruction || '기본 방향'} →</button>)}
    </details>
    <div className="concept-metrics"><GenerationMetrics /></div>
  </section>
}
