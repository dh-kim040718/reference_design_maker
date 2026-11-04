export interface ApiHealth {
  status: string
}

// In development, keep API requests on the page's origin and use Vite's proxy.
const apiBaseUrl = import.meta.env.DEV ? '' : import.meta.env.VITE_API_BASE_URL ?? ''

export interface Session {
  access_token: string; refresh_token: string; expires_in: number
  user: { id: string; email?: string }
}
export interface Project {
  id: string; name: string; archived_at: string | null; created_at: string; updated_at: string
  thumbnail_url?: string | null
  reference_count?: number
  brief?: string
}
export interface DeliverableType extends Project {
  project_id: string; project_name: string; read_only: boolean
}
export interface RegionNote {x: number; y: number; width: number; height: number; note: string}
export interface DesignGuidance {roles: string[]; regions: RegionNote[]; image_version?: string | null}
export interface Reference {
  id: string; source_url: string; title: string | null; description: string | null
  design_note: string | null; project_id: string; project_name: string
  deliverable_type_id: string; deliverable_type_name: string; read_only: boolean
  created_at: string; updated_at: string
  preview_url?: string | null; preview_source?: string | null
  design_guidance?: DesignGuidance; guidance_stale?: boolean; preview_version?: string
}
export interface Preview { preview_url: string | null; title: string | null; status: 'available' | 'unavailable'; reason?: string }
export function previewFailureMessage(preview: Preview) {
  const reason: Record<string, string> = {
    site_restricted: '이 사이트는 자동 이미지 가져오기를 제한합니다.',
    tls_error: '사이트의 보안 연결을 확인하지 못했어요.',
    timeout: '미리보기를 불러오는 데 시간이 오래 걸리고 있어요.',
    network_error: '사이트에 연결하지 못했어요.',
    page_unavailable: '원본 페이지에 접근할 수 없어요.',
    response_too_large: '미리보기 정보가 너무 커서 불러오지 못했어요.',
    no_image: '이 페이지에는 공개된 대표 이미지가 없어요.',
  }
  return (reason[preview.reason ?? ''] ?? '대표 이미지를 가져오지 못했어요.')
    + ' 원본 이미지를 복사한 뒤 Ctrl+V로 넣거나 이미지를 선택해 주세요.'
}
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
export interface Path { project_id: string; deliverable_type_id: string }

const storageKey = 'reference-maker-session'
let session: Session | null = null
function storedSession(): Session | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey) ?? 'null')
    return value && typeof value.access_token === 'string' && typeof value.refresh_token === 'string'
      && typeof value.user?.id === 'string' ? value : null
  } catch {return null}
}
session = storedSession()
let refreshing: Promise<Session> | null = null
export function getSession() { return session }
export function saveSession(value: Session | null) {
  session = value
  // Same-origin collector tabs share login; account-specific drafts remain in memory.
  if (value) localStorage.setItem(storageKey, JSON.stringify(value))
  else localStorage.removeItem(storageKey)
  sessionStorage.removeItem(storageKey)
}
if (session && !localStorage.getItem(storageKey)) saveSession(session)
function receiveSession(value: Session | null) {
  const previousUser = session?.user.id
  session = value
  if (previousUser !== session?.user.id) window.dispatchEvent(new CustomEvent('session-changed', {detail: {previousUser}}))
}
window.addEventListener('storage', event => {
  if (event.key !== storageKey && event.key !== null) return
  receiveSession(storedSession())
})
export class ApiError extends Error {
  status: number
  fields: {field: string; message: string}[]
  code?: string
  constructor(status: number, message: string, fields: {field: string; message: string}[] = [], code?: string) {
    super(message); this.status = status; this.fields = fields; this.code = code
  }
}
async function responseData<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const fallback = response.status === 404
      ? '요청한 API를 찾을 수 없습니다. 새로고침 후에도 계속되면 서버 연결 설정을 확인해 주세요.'
      : response.status >= 500 ? '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' : '요청을 처리하지 못했습니다.'
    throw new ApiError(response.status, data.detail?.message ?? fallback, data.detail?.fields ?? [], data.detail?.code)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
export async function login(email: string, password: string) {
  const value = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password}),
  }).then(responseData<Session>)
  saveSession(value)
  return value
}
async function refreshSession() {
  if (!refreshing) {
    const previous = session
    const refresh = async () => {
      const latest = storedSession()
      if (latest?.user.id !== previous?.user.id) {receiveSession(latest); throw new ApiError(401, '세션이 변경되었습니다.')}
      if (latest && latest.access_token !== previous?.access_token) {session = latest; return latest}
      return fetch(`${apiBaseUrl}/api/v1/auth/refresh`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({refresh_token: previous?.refresh_token}),
    }).then(responseData<Session>).then(value => {
      const current = storedSession()
      if (current?.user.id !== previous?.user.id) {receiveSession(current); throw new ApiError(401, '세션이 변경되었습니다.')}
      if (current && current.access_token !== previous?.access_token) {session = current; return current}
      saveSession(value)
      return value
      })
    }
    refreshing = (navigator.locks ? navigator.locks.request('reference-maker-refresh', refresh) : refresh())
      .finally(() => { refreshing = null })
  }
  return refreshing
}

export async function signup(email: string, password: string) {
  const result = await fetch(`${apiBaseUrl}/api/v1/auth/signup`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email, password}),
  }).then(responseData<{session: Session | null; message: string}>)
  if (result.session) saveSession(result.session)
  return result
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const identity = session?.user.id
  async function send() {
    try { return await fetch(`${apiBaseUrl}/api/v1${path}`, {
      method, headers: {'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}`},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    }) } catch { throw new ApiError(0, method === 'GET' ? '서버에 연결할 수 없습니다. 다시 불러와 주세요.'
      : '처리 여부를 확인하지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.') }
  }
  let response = await send()
  if (response.status === 401 && session) {
    try { await refreshSession(); response = await send() }
    catch (error) {
      if (error instanceof ApiError && error.status === 401 && session?.user.id === identity) {
        saveSession(null); window.dispatchEvent(new Event('session-expired'))
      }
      throw error
    }
  }
  if (response.status === 401 && session?.user.id === identity) {
    saveSession(null); window.dispatchEvent(new Event('session-expired'))
  }
  const current = storedSession()
  if (identity !== current?.user.id) {receiveSession(current); throw new ApiError(401, '다시 로그인해 주세요.')}
  if (identity !== session?.user.id) throw new ApiError(401, '다시 로그인해 주세요.')
  return responseData<T>(response)
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'
}

export async function getHealth(): Promise<ApiHealth> {
  const response = await fetch(`${apiBaseUrl}/health`)
  if (!response.ok) {
    throw new Error(`API health check failed with status ${response.status}.`)
  }
  return response.json() as Promise<ApiHealth>
}
