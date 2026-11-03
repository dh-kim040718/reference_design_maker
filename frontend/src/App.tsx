import { useEffect, useEffectEvent, useRef, useState, type ReactNode, type AnchorHTMLAttributes } from 'react'
import { api, ApiError, errorMessage, getSession, login, signup, saveSession, previewFailureMessage,
  type DeliverableType, type Page, type Path, type Project, type Reference, type Preview } from './lib/api'
import { Thumbnail, ImagePicker } from './Thumbnail'
import { ProjectHeader } from './ProjectHeader'
import { CollectPage } from './CollectPage'
import { GenerationPage } from './GenerationPage'
import { LegacyGenerationRedirect, ProjectGenerationPage } from './ProjectGenerationPage'
import { acceptIncomingShare, pendingShare, pendingShareRoute, clearPendingShare } from './lib/share'
import './App.css'
import './theme.css'

let dirty = false
function SavedReferenceThumbnail({item, readOnly}: {item: Reference; readOnly: boolean}) {
  const [resolved, setResolved] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (item.preview_url || readOnly) return
    let active = true
    const timer = setTimeout(() => {
      setStatus('미리보기 불러오는 중…')
      void api<Preview>('/references/preview', 'POST', {source_url: item.source_url}).then(async preview => {
        if (!active) return
        if (!preview.preview_url) {setStatus(previewFailureMessage(preview)); return}
        await api(`/references/${item.id}/thumbnail`, 'PATCH', {preview_url: preview.preview_url, preview_source: 'page_metadata'})
        if (active) {setResolved(preview.preview_url); setStatus('')}
      }).catch(() => {if (active) setStatus('원본 사이트의 미리보기를 불러오지 못했습니다.')})
    }, 200)
    return () => {active = false; clearTimeout(timer)}
  }, [item.id, item.source_url, item.preview_url, readOnly])
  return <><Thumbnail url={item.preview_url || resolved} label={item.title || host(item.source_url)} />{status && <span className="hint" role="status">{status}</span>}</>
}
function setPageDirty(value: boolean) {dirty = value}
type Draft = { ownerId: string; values: Record<string, string> }
const drafts = new Map<string, Draft>()
function readDraft(route: string) {
  const draft = drafts.get(route)
  return draft && draft.ownerId === getSession()?.user.id ? draft.values : undefined
}
function go(path: string, force = false, notice = '', preserveShare = false) {
  if (!force && dirty && !window.confirm('작성 중인 내용을 버리고 이동할까요?')) return
  dirty = false
  drafts.clear()
  if (!preserveShare && path !== '/login' && path !== '/signup') clearPendingShare()
  history.pushState({notice}, '', path)
  window.dispatchEvent(new Event('popstate'))
}
function Link({to, children, className, ...attributes}: {to: string; children: ReactNode} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'>) {
  return <a {...attributes} className={className} href={to} onClick={event => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {event.preventDefault(); go(to)}
  }}>{children}</a>
}
function useDirty(value: boolean) {
  useEffect(() => {
    dirty = value
    const warn = (event: BeforeUnloadEvent) => { if (value) {event.preventDefault(); event.returnValue = ''} }
    window.addEventListener('beforeunload', warn)
    return () => {dirty = false; window.removeEventListener('beforeunload', warn)}
  }, [value])
}
function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{key?: string; revision?: number; data?: T; error?: string}>({})
  const [revision, setRevision] = useState(0)
  const run = useEffectEvent(load)
  useEffect(() => {
    let active = true
    run().then(data => {if (active) setState({key, revision, data})}).catch(error => {if (active) setState({key, revision, error: errorMessage(error)})})
    return () => {active = false}
  }, [key, revision])
  return {...(state.key === key && state.revision === revision ? state : {}), reload: () => setRevision(value => value + 1)}
}
function Loading() { return <div className="state" role="status">라이브러리를 불러오고 있어요…</div> }
function ErrorState({message, retry}: {message: string; retry?: () => void}) {
  return <div className="state error" role="alert"><p>{message}</p>{retry && <button className="secondary" onClick={retry}>다시 불러오기</button>}
    <Link to="/projects">프로젝트 목록으로</Link></div>
}
function Heading({title, copy, children}: {title: string; copy?: string; children?: ReactNode}) {
  return <div className="page-heading"><div><p className="eyebrow">MY DESIGN LIBRARY</p><h1>{title}</h1>
    {copy && <p className="subtitle">{copy}</p>}</div><div>{children}</div></div>
}
function Pagination({page, navigate}: {page: Page<unknown>; navigate: (offset: number) => void}) {
  if (page.total <= page.limit) return null
  return <nav className="pagination" aria-label="페이지 이동"><button className="secondary" disabled={!page.offset} onClick={() => navigate(Math.max(0, page.offset - page.limit))}>이전</button>
    <span>{Math.floor(page.offset / page.limit) + 1} / {Math.ceil(page.total / page.limit)}</span>
    <button className="secondary" disabled={page.offset + page.limit >= page.total} onClick={() => navigate(page.offset + page.limit)}>다음</button></nav>
}
const date = (value: string) => new Date(value).toLocaleDateString('ko-KR')
function host(url: string) { try {return new URL(url).hostname} catch {return url} }

function NameDialog({title, initial = '', onSave, close}: {
  title: string; initial?: string; onSave: (name: string) => Promise<void>; close: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    ref.current?.showModal()
    return () => {previous?.focus()}
  }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" className="dialog" onCancel={event => {event.preventDefault(); if (!busy) close()}}>
    <form onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('')
      try {await onSave(name.trim()); close()} catch (error) {setError(errorMessage(error))} finally {setBusy(false)}
    }}><h2 id="dialog-title">{title}</h2><label>이름<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="알아보기 쉬운 이름을 입력하세요" /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>취소</button><button disabled={busy || !name.trim()}>{busy ? '저장 중…' : '저장'}</button></div>
    </form></dialog>
}

function LoginPage({onLogin, signupMode = false}: {onLogin: () => void; signupMode?: boolean}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [passwordAgain, setPasswordAgain] = useState('')
  return <section className="login-panel"><p className="eyebrow">YOUR DESIGN LIBRARY</p><h1>좋은 디자인의 단서를<br />한곳에 모아보세요.</h1>
    <p className="subtitle">프로젝트별로 레퍼런스를 정리하고, 참고할 포인트를 기록하세요.</p>
    {pendingShare() && <p className="notice">공유받은 링크를 보관하고 있어요. 로그인 후 저장 위치를 확인하세요.</p>}
    <form className="login-form" onSubmit={async event => {
      event.preventDefault(); if (busy) return; setBusy(true); setError('')
      if (signupMode && password !== passwordAgain) {setError('비밀번호가 일치하지 않습니다.'); setBusy(false); return}
      try {
        if (signupMode) {
          const result = await signup(email.trim(), password)
          if (result.session) onLogin()
          else {setConfirmation(result.message); setPassword(''); setPasswordAgain('')}
        } else {await login(email.trim(), password); onLogin()}
      } catch (error) {setError(errorMessage(error))} finally {setBusy(false)}
    }}><h2>{signupMode ? '나만의 라이브러리 만들기' : '내 라이브러리에 로그인'}</h2>
      {confirmation ? <><p className="success" role="status">{confirmation}</p><Link className="button" to="/login">로그인으로 돌아가기</Link></> : <>
      <label>이메일<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>비밀번호<input type="password" autoComplete={signupMode ? 'new-password' : 'current-password'} minLength={signupMode ? 8 : undefined} maxLength={1024} placeholder={signupMode ? '8자 이상 입력하세요' : undefined} required value={password} onChange={event => setPassword(event.target.value)} /></label>
      {signupMode && <label>비밀번호 확인<input type="password" autoComplete="new-password" required maxLength={1024} value={passwordAgain} onChange={event => setPasswordAgain(event.target.value)} /></label>}
      {error && <p className="error" role="alert">{error}</p>}<button disabled={busy}>{busy ? (signupMode ? '가입 중…' : '로그인 중…') : (signupMode ? '회원가입' : '로그인')}</button>
      <p className="hint">{signupMode ? <>이미 계정이 있나요? <Link to="/login">로그인</Link></> : <>처음 방문하셨나요? <Link to="/signup">회원가입</Link></>}</p></>}
    </form></section>
}

function LibraryPage({projectId, typeId, search}: {projectId?: string; typeId?: string; search: string}) {
  const params = new URLSearchParams(search)
  const archived = params.get('archived') === 'true'
  const offset = Math.max(0, Number(params.get('offset')) || 0)
  const base = typeId ? `/projects/${projectId}/types/${typeId}` : projectId ? `/projects/${projectId}` : '/projects'
  const [dialog, setDialog] = useState<{item?: Project; title: string} | null>(null)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const manager = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => {if (manager.current && !manager.current.contains(event.target as Node)) manager.current.open = false}
    const escape = (event: KeyboardEvent) => {if (event.key === 'Escape' && manager.current?.open) {manager.current.open = false; manager.current.querySelector('summary')?.focus()}}
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape)}
  }, [])
  const query = `?archived=${archived}&limit=24&offset=${offset}`
  const {data, error, reload} = useLoad(async () => {
    const parent = projectId ? await api<Project>(`/projects/${projectId}`) : undefined
    const kind = typeId ? await api<DeliverableType>(`/deliverable-types/${typeId}`) : undefined
    if (kind && kind.project_id !== projectId) throw new Error('항목을 찾을 수 없습니다.')
    const kinds = projectId ? await allItems<DeliverableType>(`/projects/${projectId}/deliverable-types?archived=${archived}`) : []
    const page = await api<Page<Project | Reference>>(typeId ? `/deliverable-types/${typeId}/references${query}` : projectId ? `/projects/${projectId}/references${query}` : `/projects${query}`)
    return {parent, kind, page, kinds}
  }, `${base}${query}`)
  if (error) return <ErrorState message={error} retry={reload} />
  if (!data) return <Loading />
  const readOnly = !!data.parent?.archived_at || !!data.kind?.read_only
  const title = data.kind?.name ?? data.parent?.name ?? '프로젝트'
  const path = (item: Project) => projectId ? `/deliverable-types/${item.id}` : `/projects/${item.id}`
  async function archive(item: Project) {
    if (busy || !window.confirm(item.archived_at ? '보관을 해제할까요?' : '기존 레퍼런스는 유지되며 새 레퍼런스를 추가할 수 없습니다. 보관할까요?')) return
    setBusy(true); setActionError('')
    try {await api(path(item), 'PATCH', {archived: !item.archived_at}); reload()} catch (error) {setActionError(errorMessage(error))} finally {setBusy(false)}
  }
  return <section className={`library-workspace${projectId ? ' project-library' : ''}`}>
    {projectId ? <ProjectHeader projectId={projectId} typeId={typeId} name={data.parent?.name || title} active="references" count={data.page.total} navigate={go}>
      {!readOnly && <Link className="button project-add" to={`/references/new?project=${projectId}${typeId || data.kinds.length === 1 ? `&type=${typeId || data.kinds[0].id}` : ''}`}>＋ 레퍼런스 추가</Link>}
    </ProjectHeader> : <><nav className="breadcrumbs" aria-label="현재 위치"><Link to="/projects">프로젝트</Link></nav><Heading title={title}>
      {!readOnly && (projectId ? <Link className="button" to={`/references/new?project=${projectId}${typeId || data.kinds.length === 1 ? `&type=${typeId || data.kinds[0].id}` : ''}`}>＋ 레퍼런스 추가</Link> : <button onClick={() => setDialog({title: '프로젝트 만들기'})}>＋ 프로젝트 만들기</button>)}
    </Heading></>}
    {readOnly && <div className="notice">보관된 경로입니다. 조회와 원본 열기는 가능합니다.<button className="secondary" disabled={busy} onClick={async () => {
      setBusy(true); try {await api(data.parent?.archived_at ? `/projects/${projectId}` : `/deliverable-types/${typeId}`, 'PATCH', {archived: false}); reload()} catch (error) {setActionError(errorMessage(error))} finally {setBusy(false)}
    }}>보관 해제</button></div>}
    {!projectId && <div className="tabs"><Link className={!archived ? 'active' : ''} to={base}>진행 중</Link><Link className={archived ? 'active' : ''} to={`${base}?archived=true`}>보관함</Link></div>}
    {projectId && <div className="reference-list-toolbar"><nav className="project-type-filters" aria-label="레퍼런스 분류">
      <span className="filter-caption">분류</span>
      <Link className={!typeId ? 'active' : ''} to={`/projects/${projectId}${archived ? '?archived=true' : ''}`}>전체</Link>
      {data.kinds.map(kind => <Link key={kind.id} className={typeId === kind.id ? 'active' : ''} aria-current={typeId === kind.id ? 'page' : undefined} to={`/projects/${projectId}/types/${kind.id}`}>{kind.name}</Link>)}
    </nav><div className="reference-toolbar-actions">
      {!data.parent?.archived_at && <details className="classification-manager" ref={manager}><summary>분류 관리</summary><section className="classification-panel" aria-label="분류 관리 패널">
        <strong>분류 관리</strong>
        {!data.kinds.length && <p className="hint">표시할 분류가 없습니다.</p>}
        <div className="classification-rows">{data.kinds.map(kind => <div className="classification-row" key={kind.id}>
          <span>{kind.name}</span><div>
            {!kind.archived_at && <button className="text-button" disabled={busy} aria-label={`${kind.name} 이름 변경`} onClick={() => {if (manager.current) manager.current.open = false; setDialog({item: kind, title: '이름 변경'})}}>이름 변경</button>}
            <button className="text-button" disabled={busy} aria-label={`${kind.name} ${kind.archived_at ? '보관 해제' : '보관'}`} onClick={() => {if (manager.current) manager.current.open = false; void archive(kind)}}>{kind.archived_at ? '보관 해제' : '보관'}</button>
          </div>
        </div>)}</div>
        <button className="text-button classification-add" onClick={() => {if (manager.current) manager.current.open = false; setDialog({title: '산출물 유형 추가'})}}>＋ 분류 추가</button>
      </section></details>}
      <label className="reference-status-filter">표시<select aria-label="레퍼런스 표시 상태" value={archived || !!data.kind?.archived_at ? 'archived' : 'active'} onChange={event => go(`/projects/${projectId}${event.target.value === 'archived' ? '?archived=true' : ''}`)}><option value="active">진행 중</option><option value="archived">보관함</option></select></label>
      {!readOnly && <Link className="button classification-generate" title="참고 이미지와 요구사항을 확인한 뒤 생성합니다" to={`/projects/${projectId}/generate${typeId ? `?type=${typeId}` : ''}`}>{typeId ? `${data.kind?.name || '이 분류'}로 시안 만들기 →` : '프로젝트 시안 만들기 →'}</Link>}
    </div></div>}
    {!projectId && <div className="list-caption"><span>프로젝트 {data.page.total}개</span><span>최근 수정순</span></div>}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    {!data.page.items.length ? <div className="empty"><span className="empty-mark" aria-hidden="true">＋</span>
      <h2>{archived ? '보관한 항목이 없어요' : projectId ? '첫 레퍼런스를 모아보세요' : '첫 프로젝트를 시작해보세요'}</h2>
      <p>{archived ? '보관한 분류의 레퍼런스는 이곳에서 다시 찾을 수 있어요.' : projectId ? '위의 레퍼런스 추가 버튼으로 URL을 저장하세요.' : '위의 프로젝트 만들기 버튼으로 나만의 라이브러리를 시작하세요.'}</p>
    </div> : <div className="card-grid">{data.page.items.map(item => {
      if ('source_url' in item) return <article className="reference-card" key={item.id}><Link className="card-preview" to={`/references/${item.id}?return=${encodeURIComponent(base + search)}`}><SavedReferenceThumbnail item={item} readOnly={readOnly} /></Link><p className="domain">↗ {host(item.source_url)}</p>
        <div className="reference-location-tags" aria-label="레퍼런스 소속">
          <Link to={`/projects/${item.project_id}`} className="reference-location-tag" title={`프로젝트: ${item.project_name}`}>{item.project_name}</Link>
          <Link to={`/projects/${item.project_id}/types/${item.deliverable_type_id}`} className="reference-location-tag" title={`분류: ${item.deliverable_type_name}`}>{item.deliverable_type_name}</Link>
        </div>
        <h2><Link to={`/references/${item.id}?return=${encodeURIComponent(base + search)}`}>{item.title || host(item.source_url)}</Link></h2><p className="card-note">{item.design_note || '메모 없음'}</p>
        <div className="card-bottom"><span>{date(item.created_at)}</span><a href={item.source_url} target="_blank" rel="noopener noreferrer">원본 열기 ↗</a></div></article>
      return <article className="project-card" key={item.id}><Link className="card-preview" to={projectId ? `/projects/${projectId}/types/${item.id}` : `/projects/${item.id}`}>
        {item.thumbnail_url ? <Thumbnail url={item.thumbnail_url} label={item.name} /> : <div className="project-empty-cover">
          <div className="project-empty-art" aria-hidden="true"><span /><span /><span><svg viewBox="0 0 32 28" fill="none"><rect x="1" y="1" width="30" height="26" rx="3" stroke="currentColor" strokeWidth="1.5"/><circle cx="10" cy="9" r="2.5" fill="currentColor"/><path d="m4 23 8-8 5 5 5-7 6 10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg></span></div>
          <strong>{item.reference_count === 0 ? '아직 레퍼런스가 없어요' : '대표 이미지를 기다리고 있어요'}</strong>
          <span>{item.reference_count === 0 ? '첫 링크를 추가해 프로젝트를 채워보세요.' : '저장된 레퍼런스의 미리보기가 표시됩니다.'}</span>
        </div>}
      </Link><h2><Link to={projectId ? `/projects/${projectId}/types/${item.id}` : `/projects/${item.id}`}>{item.name}</Link></h2>
        <p>{item.reference_count !== undefined && <>레퍼런스 {item.reference_count}개 · </>}{date(item.updated_at)} 수정</p>
        {!item.archived_at && !readOnly && <Link className="button secondary card-add" to={projectId ? `/references/new?project=${projectId}&type=${item.id}` : `/references/new?project=${item.id}`}>{item.reference_count === 0 ? '＋ 첫 레퍼런스 추가' : '＋ 레퍼런스 추가'}</Link>}
        <div className="card-bottom"><Link to={projectId ? `/projects/${projectId}/types/${item.id}` : `/projects/${item.id}`}>{projectId ? '레퍼런스 보기' : '프로젝트 열기'} →</Link><details><summary aria-label={`${item.name} 관리`}>관리</summary><div className="menu">
          {!item.archived_at && !readOnly && <button className="text-button" onClick={() => setDialog({item, title: '이름 변경'})}>이름 변경</button>}
          {!readOnly && <button className="text-button" disabled={busy} onClick={() => archive(item)}>{item.archived_at ? '보관 해제' : '보관'}</button>}
        </div></details></div></article>
    })}</div>}
    <Pagination page={data.page} navigate={value => go(`${base}?archived=${archived}&offset=${value}`)} />
    {dialog && <NameDialog title={dialog.title} initial={dialog.item?.name} close={() => setDialog(null)} onSave={async name => {
      await api(dialog.item ? path(dialog.item) : projectId ? `/projects/${projectId}/deliverable-types` : '/projects', dialog.item ? 'PATCH' : 'POST', {name}); reload()
    }} />}
  </section>
}

async function allItems<T>(path: string) {
  const items: T[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await api<Page<T>>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`)
    items.push(...page.items)
    if (items.length >= page.total || !page.items.length) return items
  }
}

function CreatePage({search}: {search: string}) {
  const draftRoute = '/references/new' + search
  const ownerId = getSession()?.user.id ?? ''
  const [shared] = useState(() => {
    const id = new URLSearchParams(search).get('shared')
    return id ? pendingShare(id) : null
  })
  const [form, setForm] = useState(() => ({projectId: '', typeId: '', url: shared?.url ?? '', title: shared?.title ?? '', note: shared?.note ?? '', previewUrl: '', previewSource: '', ...readDraft(draftRoute)}))
  const {projectId, typeId, url, title, note, previewUrl, previewSource} = form
  const change = (field: keyof typeof form, value: string) => setForm(previous => ({...previous, [field]: value}))
  const setProjectId = (value: string) => change('projectId', value)
  const setTypeId = (value: string) => change('typeId', value)
  const setUrl = (value: string) => change('url', value)
  const manualTitle = useRef(!!(readDraft(draftRoute)?.title || shared?.title))
  const setTitle = (value: string) => {manualTitle.current = true; change('title', value)}
  const setNote = (value: string) => change('note', value)
  useEffect(() => {drafts.set(draftRoute, {ownerId, values: form})}, [draftRoute, ownerId, form])
  const [error, setError] = useState('')
  const [fields, setFields] = useState<{field: string; message: string}[]>([])
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<'project' | 'type' | null>(null)
  const [revision, setRevision] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const initialized = useRef(!!readDraft(draftRoute))
  const initialType = useRef('')
  const requestedPath = useRef(new URLSearchParams(search))
  useDirty(!!(url || title || note || previewUrl))
  const [previewState, setPreviewState] = useState('idle')
  const [previewWarning, setPreviewWarning] = useState('')
  useEffect(() => {
    let active = true
    let parsed: URL
    try {parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol)) return} catch {return}
    const timer = setTimeout(() => {
      setPreviewState('loading')
      api<Preview>('/references/preview', 'POST', {source_url: url}).then(result => {
        if (!active) return
        setPreviewState(result.status)
        setPreviewWarning(result.status === 'unavailable' ? previewFailureMessage(result) : '')
        setForm(previous => ({...previous, title: manualTitle.current ? previous.title : result.title || previous.title,
          ...(previous.previewSource === 'user_upload' ? {} : {previewUrl: result.preview_url || '', previewSource: result.preview_url ? 'page_metadata' : ''})}))
      }).catch(() => {if (active) {setPreviewState('unavailable'); setPreviewWarning('미리보기를 확인하지 못했어요. 링크는 그대로 저장할 수 있습니다.')}})
    }, 700)
    return () => {active = false; clearTimeout(timer)}
  }, [url])
  const initial = useLoad(async () => {
    const [projects, preference] = await Promise.all([allItems<Project>('/projects'), api<{last_path: Path | null}>('/preferences')])
    return {projects, preference}
  }, `create:${revision}`)
  useEffect(() => {
    if (!initial.data || initialized.current) return
    initialized.current = true
    const explicit = requestedPath.current.get('project')
    const candidate = explicit ?? initial.data.preference.last_path?.project_id ?? ''
    if (initial.data.projects.some(item => item.id === candidate)) {
      // Initialize the selection once from the asynchronously loaded account preferences.
      // oxlint-disable-next-line react(set-state-in-effect)
      setProjectId(candidate)
      initialType.current = explicit ? requestedPath.current.get('type') ?? '' : initial.data.preference.last_path?.deliverable_type_id ?? ''
    }
  }, [initial.data])
  const types = useLoad(async () => projectId ? allItems<DeliverableType>(`/projects/${projectId}/deliverable-types`) : [], `types:${projectId}:${revision}`)
  useEffect(() => {
    if (types.data?.some(item => item.id === initialType.current)) {setTypeId(initialType.current); initialType.current = ''}
  }, [types.data])
  const back = projectId && typeId ? `/projects/${projectId}/types/${typeId}` : projectId ? `/projects/${projectId}` : '/projects'
  if (initial.error) return <ErrorState message={initial.error} retry={initial.reload} />
  if (!initial.data) return <Loading />
  return <div className="form-page compact-workspace"><div className="workspace-heading"><div><p className="eyebrow">NEW REFERENCE</p><h1>레퍼런스 추가</h1></div><Link className="close-panel" to={back}>닫기 ×</Link></div>
    {shared && <p className={shared.warning ? 'notice' : 'share-received'} role="status">{shared.warning || '외부에서 가져온 레퍼런스입니다. URL과 저장 위치를 확인한 뒤 저장하세요.'}</p>}
    {!shared && new URLSearchParams(search).has('shared') && <p className="notice" role="status">공유 정보가 만료되었어요. URL을 다시 입력해 주세요.</p>}
    <div className="capture-layout"><div className="capture-fields">
    <form className="editor" ref={formRef} onSubmit={async event => {
      event.preventDefault(); if (busy) return; setError(''); setFields([])
      try {const parsed = new URL(url.trim()); if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error()}
      catch {setError('올바른 HTTP/HTTPS 주소를 입력해 주세요.'); formRef.current?.querySelector<HTMLInputElement>('[name=source_url]')?.focus(); return}
      setBusy(true)
      try {
        let savedPreview = previewUrl
        let savedSource = previewSource
        if (!savedPreview && savedSource !== 'user_upload') {
          try {
            const preview = await api<Preview>('/references/preview', 'POST', {source_url: url.trim()})
            if (preview.preview_url) {savedPreview = preview.preview_url; savedSource = 'page_metadata'}
          } catch { /* A metadata failure must not prevent saving the reference. */ }
        }
        const result = await api<Reference>('/references', 'POST', {project_id: projectId, deliverable_type_id: typeId, source_url: url.trim(), title: title || null, design_note: note || null, preview_url: savedPreview || null, preview_source: savedPreview ? savedSource || null : null})
        go(`/projects/${result.project_id}/types/${result.deliverable_type_id}`, true, '레퍼런스를 저장했습니다.')
      } catch (error) {
        setError(errorMessage(error))
        if (error instanceof ApiError && error.fields[0]) {
          setFields(error.fields)
          const field = error.fields[0].field.replace(/[^a-z_]/g, '')
          formRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus()
        }
      } finally {setBusy(false)}
    }}><fieldset disabled={busy}>
      <label>URL <span className="required">필수</span><input name="source_url" type="url" autoFocus required maxLength={4096} placeholder="레퍼런스 링크를 붙여넣으세요" value={url} onChange={event => {setUrl(event.target.value); setPreviewState('idle'); setForm(previous => ({...previous, title: manualTitle.current ? previous.title : '', ...(previous.previewSource === 'user_upload' ? {} : {previewUrl: '', previewSource: ''})}))}} /></label>
      <div className="field-row"><label>프로젝트 <span className="required">필수</span><select name="project_id" required value={projectId} onChange={event => {initialType.current = ''; setProjectId(event.target.value); setTypeId('')}}>
        <option value="">프로젝트 선택</option>{initial.data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button type="button" className="text-button" onClick={() => setDialog('project')}>＋ 프로젝트 만들기</button></label>
        <label>산출물 유형 <span className="required">필수</span><select name="deliverable_type_id" required disabled={!projectId || !types.data} value={typeId} onChange={event => setTypeId(event.target.value)}>
          <option value="">{!projectId ? '프로젝트를 먼저 선택하세요' : !types.data ? '불러오는 중…' : '산출물 유형 선택'}</option>{types.data?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button type="button" className="text-button" disabled={!projectId} onClick={() => setDialog('type')}>＋ 유형 만들기</button></label></div>
      {types.error && <ErrorState message={types.error} retry={types.reload} />}
      <label>제목 <span className="optional">선택</span><input name="title" maxLength={200} placeholder="어떤 레퍼런스인가요?" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>디자인 메모 <span className="optional">선택</span><textarea name="design_note" maxLength={5000} rows={3} placeholder="참고하고 싶은 레이아웃, 색감, 타이포그래피를 남겨보세요." value={note} onChange={event => setNote(event.target.value)} /></label>
      {error && <div className="error" role="alert"><p>{error}</p>{fields.map((field, index) => <p key={index}>{field.message}</p>)}</div>}
      <div className="form-actions"><Link className="button secondary" to={back}>취소</Link><button disabled={busy || !projectId || !typeId}>{busy ? '저장 중…' : '레퍼런스 저장'}</button></div>
    </fieldset></form></div>
    <aside className="capture-preview"><p className="section-kicker">카드 미리보기</p><Thumbnail url={previewUrl} label={title || '레퍼런스 썸네일'} />
      <h2>{title || (url ? host(url) : '레퍼런스 제목')}</h2><p className="domain">{url ? host(url) : '링크를 입력하면 출처가 표시됩니다'}</p>
      <p className="hint" role="status">{previewState === 'loading' ? '링크의 대표 이미지를 불러오는 중…' : previewUrl ? '저장 후 카드에 표시될 이미지입니다.' : previewWarning || '이미지를 불러오지 못해도 링크는 저장할 수 있어요.'}</p>
      <ImagePicker disabled={busy} label={previewUrl ? '이미지 변경' : '썸네일 이미지 선택'} onChange={value => setForm(previous => ({...previous, previewUrl: value, previewSource: 'user_upload'}))} />
      {previewUrl && <button type="button" className="text-button" disabled={busy} onClick={() => setForm(previous => ({...previous, previewUrl: '', previewSource: 'user_upload'}))}>이미지 제거</button>}
      <p className="hint">직접 선택한 이미지는 카드용 썸네일로 저장됩니다.</p>
    </aside></div>
    {dialog && <NameDialog title={dialog === 'project' ? '프로젝트 만들기' : '산출물 유형 추가'} close={() => setDialog(null)} onSave={async name => {
      if (dialog === 'project') {const item = await api<Project>('/projects', 'POST', {name}); setProjectId(item.id); setTypeId('')}
      else {const item = await api<DeliverableType>(`/projects/${projectId}/deliverable-types`, 'POST', {name}); setTypeId(item.id)}
      initialType.current = ''; setRevision(value => value + 1)
    }} />}
  </div>
}

function DetailPage({id, search}: {id: string; search: string}) {
  const {data, error, reload} = useLoad(() => api<Reference>(`/references/${id}`), id)
  const draftRoute = '/references/' + id
  const ownerId = getSession()?.user.id ?? ''
  const [editing, setEditing] = useState(!!readDraft(draftRoute))
  const [note, setNote] = useState(readDraft(draftRoute)?.note ?? '')
  useEffect(() => {if (editing) drafts.set(draftRoute, {ownerId, values: {note}})}, [draftRoute, ownerId, editing, note])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saved, setSaved] = useState(false)
  const [thumbnailBusy, setThumbnailBusy] = useState(false)
  const [thumbnailError, setThumbnailError] = useState('')
  const attemptedThumbnail = useRef(false)
  const siblings = useLoad(async () => data ? api<Page<Reference>>(`/deliverable-types/${data.deliverable_type_id}/references?limit=100`) : undefined,
    data?.deliverable_type_id ?? 'no-selection')
  const loadExistingThumbnail = useEffectEvent(async (sourceUrl: string, isActive: () => boolean) => {
    setThumbnailBusy(true)
    try {
      const preview = await api<Preview>('/references/preview', 'POST', {source_url: sourceUrl})
      if (!isActive()) return
      if (preview.preview_url) {
        await api(`/references/${id}/thumbnail`, 'PATCH', {preview_url: preview.preview_url, preview_source: 'page_metadata'})
        if (isActive()) {reload(); siblings.reload()}
      } else setThumbnailError(previewFailureMessage(preview))
    } catch {if (isActive()) setThumbnailError('썸네일을 불러오지 못했습니다. 다시 시도해 주세요.')}
    finally {if (isActive()) setThumbnailBusy(false)}
  })
  useEffect(() => {
    if (!data || data.preview_url || data.read_only || attemptedThumbnail.current) return
    let active = true
    const timer = setTimeout(() => {
      attemptedThumbnail.current = true
      void loadExistingThumbnail(data.source_url, () => active)
    }, 250)
    return () => {active = false; clearTimeout(timer)}
  }, [data])
  useDirty(editing && note !== (data?.design_note ?? ''))
  if (error) return <ErrorState message={error} retry={reload} />
  if (!data) return <Loading />
  const base = `/projects/${data.project_id}/types/${data.deliverable_type_id}`
  const requested = new URLSearchParams(search).get('return')
  const back = requested && (requested === base || requested.startsWith(base + '?')) ? requested : base
  async function saveThumbnail(value: string | null, source: string | null) {
    setThumbnailBusy(true); setThumbnailError('')
    try {await api(`/references/${id}/thumbnail`, 'PATCH', {preview_url: value, preview_source: source}); reload(); siblings.reload()}
    catch (error) {setThumbnailError(errorMessage(error))} finally {setThumbnailBusy(false)}
  }
  return <div className="reference-workspace"><div className="workspace-heading"><nav className="breadcrumbs" aria-label="현재 위치"><Link to="/projects">프로젝트</Link><span>/</span><Link to={`/projects/${data.project_id}`}>{data.project_name}</Link><span>/</span><Link to={base}>{data.deliverable_type_name}</Link></nav><Link className="close-panel" to={back}>목록으로 ×</Link></div>
    <div className="reference-split"><aside className="reference-browser"><div className="browser-heading"><h2>{data.deliverable_type_name}</h2><span>{siblings.data?.total ?? '…'}개</span></div>
      {!data.read_only && <Link className="button secondary" to={`/references/new?project=${data.project_id}&type=${data.deliverable_type_id}`}>＋ 레퍼런스 추가</Link>}
      <div className="reference-rail">{siblings.data?.items.map(item => <Link className={`rail-item ${item.id === id ? 'selected' : ''}`} key={item.id} to={`/references/${item.id}?return=${encodeURIComponent(back)}`}>
        <Thumbnail url={item.preview_url} label={item.title || host(item.source_url)} /><div><strong>{item.title || host(item.source_url)}</strong><span>{host(item.source_url)}</span><p>{item.design_note || '메모 없음'}</p></div></Link>)}</div>
      {siblings.error && <p className="hint">다른 레퍼런스를 불러오지 못했습니다. <button className="text-button" onClick={siblings.reload}>다시 불러오기</button></p>}
      {siblings.data && siblings.data.total > siblings.data.items.length && <Link to={base}>전체 목록 보기 →</Link>}
    </aside><article className="detail inspector"><div className="inspector-summary"><div className="inspector-visual"><Thumbnail className="inspector-image" url={data.preview_url} label={data.title || host(data.source_url)} />
      {!data.read_only && <><div className="thumbnail-actions"><ImagePicker showHint={false} disabled={thumbnailBusy} label={data.preview_url ? '이미지 변경' : '이미지 선택'} onChange={value => saveThumbnail(value, 'user_upload')} />
        <button className="secondary" disabled={thumbnailBusy} onClick={async () => {
          setThumbnailBusy(true); setThumbnailError('')
          try {
            const preview = await api<Preview>('/references/preview', 'POST', {source_url: data.source_url, refresh: true})
            if (preview.preview_url) await saveThumbnail(preview.preview_url, 'page_metadata')
            else setThumbnailError(previewFailureMessage(preview))
          } catch (error) {setThumbnailError(errorMessage(error))} finally {setThumbnailBusy(false)}
        }}>{thumbnailBusy ? '처리 중…' : '링크에서 불러오기'}</button></div><p className="image-help">이미지를 복사한 뒤 <kbd>Ctrl</kbd> + <kbd>V</kbd>로 붙여넣기</p></>}
      {thumbnailError && <p className="hint" role="status">{thumbnailError}</p>}
      </div><div className="inspector-info"><div className="inspector-title"><p className="domain">{host(data.source_url)}</p><h1>{data.title || host(data.source_url)}</h1></div>
      <div className="reference-location"><Link to={`/projects/${data.project_id}`}>{data.project_name}</Link><span>/</span><span>{data.deliverable_type_name}</span></div>
      <a className="button secondary source-button" href={data.source_url} target="_blank" rel="noopener noreferrer">원본 열기 ↗</a>
      <a className="source-url" href={data.source_url} title={data.source_url} target="_blank" rel="noopener noreferrer">{data.source_url}</a>
      </div></div>
      {data.read_only && <p className="notice">보관된 경로입니다. 메모 수정은 보관 해제 후 가능합니다.</p>}
      <section className="note-section"><div className="section-heading"><h2>디자인 메모</h2>{!editing && !data.read_only && <button className="secondary note-edit-button" onClick={() => {setNote(data.design_note ?? ''); setEditing(true); setSaved(false)}}>메모 수정</button>}</div>
        {editing ? <form onSubmit={async event => {
          event.preventDefault(); if (busy) return; setBusy(true); setSaveError('')
          try {await api(`/references/${id}`, 'PATCH', {design_note: note}); drafts.delete(draftRoute); dirty = false; setEditing(false); setSaved(true); reload()}
          catch (error) {setSaveError(errorMessage(error))} finally {setBusy(false)}
        }}><label>디자인 포인트 메모<textarea autoFocus disabled={busy} maxLength={5000} rows={4} value={note} onChange={event => setNote(event.target.value)} /></label>
          {saveError && <p className="error" role="alert">{saveError}</p>}<div className="form-actions"><button className="secondary" type="button" disabled={busy} onClick={() => {if (!dirty || window.confirm('수정 중인 메모를 버릴까요?')) {drafts.delete(draftRoute); setEditing(false)}}}>취소</button><button disabled={busy}>{busy ? '저장 중…' : '메모 저장'}</button></div>
        </form> : <p className={`note-content ${!data.design_note ? 'muted' : ''}`}>{data.design_note || '참고하고 싶은 디자인 포인트를 남겨보세요.'}</p>}
      </section><div className="inspector-footer"><span>저장 {date(data.created_at)}</span><span>수정 {date(data.updated_at)}</span></div>{saved && <p role="status" className="success">메모를 저장했습니다.</p>}</article>
    </div></div>
}

function App() {
  const [location, setLocation] = useState(acceptIncomingShare)
  const [user, setUser] = useState(getSession()?.user ?? null)
  const [checking, setChecking] = useState(!!getSession())
  const [authError, setAuthError] = useState('')
  const [authRevision, setAuthRevision] = useState(0)
  const [loggingOut, setLoggingOut] = useState(false)
  const [notice, setNotice] = useState('')
  const previous = useRef(location)
  useEffect(() => {
    const update = () => {
      const next = acceptIncomingShare()
      if (dirty && next !== previous.current && !window.confirm('작성 중인 내용을 버리고 이동할까요?')) {history.pushState(null, '', previous.current); return}
      dirty = false; previous.current = next; setLocation(next); setNotice(history.state?.notice ?? '')
    }
    const expire = () => {dirty = false; setUser(null); setChecking(false); setAuthError('세션이 만료되었습니다. 다시 로그인해 주세요.')}
    const changeSession = (event: Event) => {
      drafts.clear(); dirty = false
      if ((event as CustomEvent).detail?.previousUser) clearPendingShare()
      const next = getSession()
      setUser(next?.user ?? null); setChecking(!!next); setAuthError('')
      setAuthRevision(value => value + 1)
    }
    window.addEventListener('popstate', update); window.addEventListener('session-expired', expire)
    window.addEventListener('session-changed', changeSession)
    return () => {window.removeEventListener('popstate', update); window.removeEventListener('session-expired', expire); window.removeEventListener('session-changed', changeSession)}
  }, [])
  useEffect(() => {
    let active = true
    if (getSession()) api<{id: string; email?: string}>('/me').then(value => {if (active) {setUser(value); setChecking(false); setAuthError('')}})
      .catch(error => {if (active) {setAuthError(errorMessage(error)); setChecking(false)}})
    return () => {active = false}
  }, [authRevision])
  const url = new URL(location, window.location.origin)
  const parts = url.pathname.split('/').filter(Boolean)
  let content: ReactNode
  if (checking) content = <Loading />
  else if (authError && user) content = <ErrorState message={authError} retry={() => {setChecking(true); setAuthRevision(value => value + 1)}} />
  else if (!user) content = <LoginPage key={url.pathname} signupMode={url.pathname === '/signup'} onLogin={() => {
    setUser(getSession()?.user ?? null); setAuthError(''); setChecking(true); setAuthRevision(value => value + 1)
    if (url.pathname === '/login' || url.pathname === '/signup' || url.pathname === '/') {
      const sharedRoute = pendingShareRoute()
      go(sharedRoute || '/projects', true, '', !!sharedRoute)
    }
  }} />
  else if (parts[0] === 'references' && parts[1] === 'new') content = <CreatePage key={user.id + location} search={url.search} />
  else if (url.pathname === '/collect') content = <CollectPage />
  else if (parts[0] === 'projects' && parts[2] === 'generate' && parts.length === 3) content = <ProjectGenerationPage key={user.id + location} projectId={parts[1]} typeId={url.searchParams.get('type') || undefined} fromJobId={url.searchParams.get('from') || undefined} navigate={go} onDirtyChange={setPageDirty} />
  else if (parts[0] === 'references' && parts[2] === 'generate' && parts.length === 3) content = <LegacyGenerationRedirect key={user.id + location} referenceId={parts[1]} navigate={go} />
  else if (parts[0] === 'generations' && parts[1] && parts.length === 2) content = <GenerationPage key={user.id + location} jobId={parts[1]} navigate={go} />
  else if (parts[0] === 'references' && parts[1] && parts.length === 2) content = <DetailPage key={user.id + parts[1]} id={parts[1]} search={url.search} />
  else if (!parts.length || url.pathname === '/login' || (parts[0] === 'projects' && (parts.length <= 2 || (parts.length === 4 && parts[2] === 'types')))) content = <LibraryPage key={user.id + location} projectId={parts[1]} typeId={parts[3]} search={url.search} />
  else content = <ErrorState message="페이지를 찾을 수 없습니다." />
  return <div className={`app-shell${user ? ' app-workspace' : ''}`}><header className="topbar"><Link className="brand" to="/projects"><span className="brand-mark">R</span>레퍼런스 메이커</Link>
    {user && <div className="account"><Link className="collect-nav" to="/collect">외부에서 저장</Link><span>{user.email}</span><button className="text-button" disabled={loggingOut} onClick={async () => {
      if (dirty && !window.confirm('작성 중인 내용을 버리고 로그아웃할까요?')) return
      setLoggingOut(true)
      try {await api('/auth/logout', 'POST'); saveSession(null); clearPendingShare(); dirty = false; setUser(null); setAuthError(''); go('/login', true)}
      catch (error) {setAuthError(errorMessage(error))} finally {setLoggingOut(false)}
    }}>{loggingOut ? '로그아웃 중…' : '로그아웃'}</button></div>}</header>
    <main className="main-content">{!user && authError && <p className="error" role="alert">{authError}</p>}{user && notice && <p className="success" role="status">{notice}</p>}{content}</main>
    <footer className="footer"><span>디자인의 단서를 모으는 나만의 라이브러리</span><span>REFERENCE DESIGN MAKER</span></footer></div>
}
export default App
