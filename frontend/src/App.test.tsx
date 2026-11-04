import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { clearPendingShare } from './lib/share'
import { api, ApiError, getSession, login, signup, saveSession, type Session } from './lib/api'

vi.mock('./lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('./lib/api')>(),
  api: vi.fn(), getSession: vi.fn(), login: vi.fn(), signup: vi.fn(), saveSession: vi.fn(),
}))
const session: Session = {access_token: 'test', refresh_token: 'refresh', expires_in: 3600,
  user: {id: 'owner', email: 'owner@example.com'}}
const project = {id: 'project', name: '브랜드 리뉴얼', archived_at: null, updated_at: '2026-10-29T00:00:00Z'}
const kind = {...project, id: 'type', name: '웹사이트', project_id: 'project', project_name: project.name, read_only: false}
const reference = {id: 'ref', source_url: 'https://example.com/design', project_id: 'project', deliverable_type_id: 'type',
  title: null, description: null, design_note: null, project_name: project.name, deliverable_type_name: kind.name,
  read_only: false, created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z'}
function page(items: unknown[]) {return {items, total: items.length, limit: 24, offset: 0}}
function authorized() {
  vi.mocked(getSession).mockReturnValue(session)
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/me') return session.user
    if (path === '/auth/logout') return undefined
    if (path === '/preferences') return {last_path: {project_id: 'project', deliverable_type_id: 'type'}}
    if (path === '/references/preview') return {preview_url: null, title: null, status: 'unavailable'}
    if (path.startsWith('/projects?')) return page([project])
    if (path === '/projects/project') return project
    if (path.startsWith('/projects/project/references')) return page([reference])
    if (path.startsWith('/projects/project/deliverable-types')) return page([kind])
    if (path === '/deliverable-types/type') return kind
    if (path.startsWith('/deliverable-types/type/references')) return page([reference])
    if (path === '/references/ref') return reference
    throw new Error(`Unexpected request: ${path}`)
  })
}
beforeEach(() => {
  clearPendingShare()
  history.replaceState(null, '', '/projects')
  vi.mocked(getSession).mockReturnValue(null)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable: true, value() {this.open = true}})
})
afterEach(() => {cleanup(); vi.resetAllMocks()})

describe('Phase 2 library', () => {
  it('gives empty projects a full cover, an honest empty message and a first action', async () => {
    authorized()
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, method, body) => path.startsWith('/projects?') ? page([{...project, reference_count: 0}]) : original(path, method, body))
    render(<App />)
    expect(await screen.findByText('아직 레퍼런스가 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', {name: '＋ 첫 레퍼런스 추가'})).toHaveAttribute('href', '/references/new?project=project')
    expect(document.querySelector('.folder-mark')).toBeNull()
  })
  it('keeps classification navigation separate from management actions', async () => {
    authorized()
    history.replaceState(null, '', '/projects/project')
    render(<App />)
    const filters = await screen.findByRole('navigation', {name: '레퍼런스 분류'})
    expect(filters.querySelector('details')).toBeNull()
    expect(filters).not.toHaveTextContent('분류 추가')
    const manager = document.querySelector<HTMLDetailsElement>('.classification-manager')!
    fireEvent.click(manager.querySelector('summary')!)
    expect(manager.open).toBe(true)
    fireEvent.keyDown(document, {key: 'Escape'})
    expect(manager.open).toBe(false)
    fireEvent.click(manager.querySelector('summary')!)
    fireEvent.click(screen.getByRole('button', {name: '웹사이트 이름 변경'}))
    expect(manager.open).toBe(false)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('웹사이트')
  })
  it('opens project references directly and offers classification filters', async () => {
    authorized()
    history.replaceState(null, '', '/projects/project')
    render(<App />)
    expect(await screen.findByRole('heading', {name: 'example.com'})).toBeInTheDocument()
    expect(screen.getByRole('navigation', {name: '레퍼런스 분류'})).toHaveTextContent('웹사이트')
    expect(screen.queryByRole('link', {name: '레퍼런스 보기 →'})).not.toBeInTheDocument()
  })
  it('prefills an external shared link and does not save until the user confirms', async () => {
    authorized()
    history.replaceState(null, '', '/share?' + new URLSearchParams({url: reference.source_url, title: 'Shared design', text: '좋은 여백'}))
    render(<App />)
    expect(await screen.findByRole('textbox', {name: /URL/})).toHaveValue(reference.source_url)
    expect(screen.getByRole('textbox', {name: /제목/})).toHaveValue('Shared design')
    expect(screen.getByRole('textbox', {name: /디자인 메모/})).toHaveValue('좋은 여백')
    expect(window.location.search).not.toContain('example.com')
    expect(api).not.toHaveBeenCalledWith('/references', 'POST', expect.anything())
  })

  it('keeps an external share while the user logs in', async () => {
    history.replaceState(null, '', '/share?' + new URLSearchParams({url: reference.source_url, title: 'After login'}))
    vi.mocked(login).mockImplementation(async () => {authorized(); return session})
    render(<App />)
    expect(screen.getByText(/공유받은 링크를 보관/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('이메일'), {target: {value: 'owner@example.com'}})
    fireEvent.change(screen.getByLabelText('비밀번호'), {target: {value: 'password'}})
    fireEvent.submit(screen.getByRole('button', {name: '로그인'}).closest('form')!)
    expect(await screen.findByRole('textbox', {name: /URL/})).toHaveValue(reference.source_url)
    expect(screen.getByRole('textbox', {name: /제목/})).toHaveValue('After login')
  })

  it('prefills and saves the extension thumbnail without another metadata lookup', async () => {
    authorized()
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, method, body) => path === '/references' && method === 'POST' ? reference : original(path, method, body))
    history.replaceState(null, '', '/share?' + new URLSearchParams({url: reference.source_url, title: 'Shared image'}) + '#' + new URLSearchParams({preview: 'https://i.pinimg.com/cover.jpg'}))
    render(<App />)
    await screen.findByRole('textbox', {name: /URL/})
    expect(document.querySelector('.capture-preview img')).toHaveAttribute('src', 'https://i.pinimg.com/cover.jpg')
    await waitFor(() => expect(screen.getByRole('combobox', {name: /산출물 유형/})).toHaveValue('type'))
    fireEvent.submit(screen.getByRole('button', {name: '레퍼런스 저장'}).closest('form')!)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/references', 'POST', expect.objectContaining({preview_url: 'https://i.pinimg.com/cover.jpg', preview_source: 'page_metadata'})))
    expect(api).not.toHaveBeenCalledWith('/references/preview', 'POST', expect.anything())
  })

  it('falls back to manual URL entry when shared information has no valid link', async () => {
    authorized(); history.replaceState(null, '', '/share?title=Only%20a%20title&url=javascript%3Aalert(1)')
    render(<App />)
    expect(await screen.findByRole('textbox', {name: /URL/})).toHaveValue('')
    expect(screen.getByText(/공유된 내용에 사용할 수 있는 링크가 없어요/)).toBeInTheDocument()
  })

  it('automatically fills a missing thumbnail on an existing reference', async () => {
    authorized(); history.replaceState(null, '', '/references/ref')
    const original = vi.mocked(api).getMockImplementation()!
    let stored = false
    vi.mocked(api).mockImplementation(async (path, method, body) => {
      if (path === '/references/preview') return {preview_url: 'https://example.com/cover.jpg', title: 'Reference', status: 'available'}
      if (path === '/references/ref/thumbnail') {stored = true; return {...reference, preview_url: 'https://example.com/cover.jpg'}}
      if (path === '/references/ref' && stored) return {...reference, preview_url: 'https://example.com/cover.jpg'}
      return original(path, method, body)
    })
    render(<App />)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/references/ref/thumbnail', 'PATCH', {preview_url: 'https://example.com/cover.jpg', preview_source: 'page_metadata'}), {timeout: 3000})
  })

  it('explains when the source site blocks thumbnail collection', async () => {
    authorized(); history.replaceState(null, '', '/references/ref')
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, method, body) => path === '/references/preview'
      ? {preview_url: null, title: null, status: 'unavailable', reason: 'site_restricted'} : original(path, method, body))
    render(<App />)
    expect(await screen.findByText(/이 사이트는 자동 이미지 가져오기를 제한합니다/)).toBeInTheDocument()
    expect(api).not.toHaveBeenCalledWith('/references/ref/thumbnail', 'PATCH', expect.anything())
  })

  it('removes description and shows a thumbnail preview beside the input fields', async () => {
    authorized(); history.replaceState(null, '', '/references/new')
    render(<App />)
    expect(await screen.findByText('카드 미리보기')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', {name: /^설명/})).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: '썸네일 이미지 선택'})).toBeInTheDocument()
  })

  it('opens reference creation directly from a project card with its project selected', async () => {
    authorized()
    render(<App />)
    expect(await screen.findByRole('link', {name: '프로젝트 열기 →'})).toHaveAttribute('href', '/projects/project')
    fireEvent.click(screen.getByRole('link', {name: '＋ 레퍼런스 추가'}))
    expect(window.location.pathname).toBe('/references/new')
    await waitFor(() => expect(screen.getByRole('combobox', {name: /프로젝트/})).toHaveValue('project'))
    expect(await screen.findByRole('button', {name: '레퍼런스 저장'})).toBeInTheDocument()
  })

  it('opens reference creation from a type card with both classifications selected', async () => {
    authorized(); history.replaceState(null, '', '/projects/project')
    render(<App />)
    fireEvent.click(await screen.findByRole('link', {name: '＋ 레퍼런스 추가'}))
    await waitFor(() => expect(screen.getByRole('combobox', {name: /산출물 유형/})).toHaveValue('type'))
    expect(screen.getByRole('combobox', {name: /프로젝트/})).toHaveValue('project')
  })

  it('opens signup and validates password confirmation before submitting', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', {name: '회원가입'}))
    fireEvent.change(screen.getByLabelText('이메일'), {target: {value: 'new@example.com'}})
    fireEvent.change(screen.getByLabelText('비밀번호'), {target: {value: 'password123'}})
    fireEvent.change(screen.getByLabelText('비밀번호 확인'), {target: {value: 'different123'}})
    fireEvent.submit(screen.getByRole('button', {name: '회원가입'}).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('비밀번호가 일치하지 않습니다.')
    expect(signup).not.toHaveBeenCalled()
  })

  it('shows an email confirmation message without claiming to be logged in', async () => {
    vi.mocked(signup).mockResolvedValue({session: null, message: '이메일 확인 링크를 열어주세요.'})
    history.replaceState(null, '', '/signup')
    render(<App />)
    fireEvent.change(screen.getByLabelText('이메일'), {target: {value: 'new@example.com'}})
    for (const name of ['비밀번호', '비밀번호 확인']) fireEvent.change(screen.getByLabelText(name), {target: {value: 'password123'}})
    fireEvent.submit(screen.getByRole('button', {name: '회원가입'}).closest('form')!)
    expect(await screen.findByRole('status')).toHaveTextContent('이메일 확인 링크를 열어주세요.')
    expect(screen.getByRole('link', {name: '로그인으로 돌아가기'})).toBeInTheDocument()
    expect(api).not.toHaveBeenCalled()
  })

  it('requires login and displays authentication errors', async () => {
    vi.mocked(login).mockRejectedValue(new Error('로그인 정보를 확인해 주세요.'))
    render(<App />)
    fireEvent.change(screen.getByLabelText('이메일'), {target: {value: 'test@example.com'}})
    fireEvent.change(screen.getByLabelText('비밀번호'), {target: {value: 'incorrect'}})
    fireEvent.submit(screen.getByRole('button', {name: '로그인'}).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인 정보를 확인해 주세요.')
    expect(api).not.toHaveBeenCalled()
  })

  it('creates a project and reloads the list only after success', async () => {
    authorized()
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, method, body) => {
      if (path === '/projects' && method === 'POST') return {...project, name: (body as {name: string}).name}
      return original(path, method, body)
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', {name: /프로젝트 만들기/}))
    fireEvent.change(screen.getByLabelText('이름'), {target: {value: '신규 프로젝트'}})
    fireEvent.submit(screen.getByRole('button', {name: '저장'}).closest('form')!)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/projects', 'POST', {name: '신규 프로젝트'}))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByRole('link', {name: project.name})).toBeInTheDocument()
  })

  it('keeps failed URL input and does not display a save success message', async () => {
    authorized(); history.replaceState(null, '', '/references/new')
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, method, body) => {
      if (path === '/references' && method === 'POST') throw new ApiError(503, '저장 실패')
      return original(path, method, body)
    })
    render(<App />)
    const url = await screen.findByRole('textbox', {name: /URL/})
    fireEvent.change(url, {target: {value: 'https://example.com/design'}})
    await waitFor(() => expect(screen.getByRole('combobox', {name: /산출물 유형/})).toHaveValue('type'))
    fireEvent.submit(screen.getByRole('button', {name: '레퍼런스 저장'}).closest('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('저장 실패')
    expect(url).toHaveValue('https://example.com/design')
    expect(screen.queryByText('레퍼런스를 저장했습니다.')).not.toBeInTheDocument()
  })

  it('saves a URL without optional fields to the selected path', async () => {
    authorized(); history.replaceState(null, '', '/references/new?project=project&type=type')
    const original = vi.mocked(api).getMockImplementation()!
    vi.mocked(api).mockImplementation(async (path, method, body) => {
      if (path === '/references' && method === 'POST') return reference
      return original(path, method, body)
    })
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', {name: /URL/}), {target: {value: reference.source_url}})
    await waitFor(() => expect(screen.getByRole('button', {name: '레퍼런스 저장'})).toBeEnabled())
    fireEvent.submit(screen.getByRole('button', {name: '레퍼런스 저장'}).closest('form')!)
    expect(await screen.findByText('레퍼런스를 저장했습니다.')).toBeInTheDocument()
    expect(api).toHaveBeenCalledWith('/references', 'POST', {project_id: 'project', deliverable_type_id: 'type', source_url: reference.source_url, title: null, design_note: null, preview_url: null, preview_source: null})
    expect(await screen.findByRole('link', {name: 'example.com'})).toBeInTheDocument()
  })

  it('edits a note without changing its URL or classification', async () => {
    authorized(); history.replaceState(null, '', '/references/ref')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', {name: '메모 수정'}))
    fireEvent.change(screen.getByLabelText('디자인 포인트 메모'), {target: {value: '여백과 제목'}})
    fireEvent.submit(screen.getByRole('button', {name: '메모 저장'}).closest('form')!)
    await waitFor(() => expect(api).toHaveBeenCalledWith('/references/ref', 'PATCH', {design_note: '여백과 제목'}))
    expect(await screen.findByText('메모를 저장했습니다.')).toBeInTheDocument()
  })

  it('clears session and returns to login on logout', async () => {
    authorized(); render(<App />)
    fireEvent.click(await screen.findByRole('button', {name: '로그아웃'}))
    await waitFor(() => expect(saveSession).toHaveBeenCalledWith(null))
    expect(await screen.findByRole('button', {name: '로그인'})).toBeInTheDocument()
    expect(screen.queryByText(project.name)).not.toBeInTheDocument()
  })

  it('restores an unsaved draft after reauthenticating the same account', async () => {
    authorized(); history.replaceState(null, '', '/references/new')
    vi.mocked(login).mockResolvedValue(session)
    render(<App />)
    fireEvent.change(await screen.findByRole('textbox', {name: /URL/}), {target: {value: 'https://example.com/unsaved'}})
    await waitFor(() => expect(screen.getByRole('button', {name: '레퍼런스 저장'})).toBeEnabled())
    window.dispatchEvent(new Event('session-expired'))
    fireEvent.change(await screen.findByLabelText('이메일'), {target: {value: 'owner@example.com'}})
    fireEvent.change(screen.getByLabelText('비밀번호'), {target: {value: 'password'}})
    fireEvent.submit(screen.getByRole('button', {name: '로그인'}).closest('form')!)
    expect(await screen.findByRole('textbox', {name: /URL/})).toHaveValue('https://example.com/unsaved')
  })
})
