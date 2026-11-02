export interface SharedReference {
  url: string
  title: string
  note: string
  warning: string
}
const pendingKey = 'reference-maker-pending-share'
const expiryMs = 15 * 60 * 1000

export function webUrl(input: string): string | null {
  const value = input.trim()
  if (!value || value.length > 4096 || /\s/u.test(value) || [...value].some(char => char.charCodeAt(0) < 32)) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return value
  } catch {return null}
}

export function normalizeShare(params: URLSearchParams): SharedReference {
  const title = (params.get('title') ?? '').trim().slice(0, 200)
  const text = (params.get('text') ?? params.get('description') ?? '').trim().slice(0, 8000)
  const explicit = webUrl(params.get('url') ?? '')
  const found = [...text.matchAll(/https?:\/\/[^\s<>"]+/gu)]
    .map(match => webUrl(match[0].replace(/[.,;!]+$/u, ''))).filter((value): value is string => !!value)
  const urls = [...new Set([...(explicit ? [explicit] : []), ...found])]
  const url = urls[0] ?? ''
  const note = text.replace(url, '').trim()
  return {
    url, title, note: note === title ? '' : note.slice(0, 5000),
    warning: !url ? '공유된 내용에 사용할 수 있는 링크가 없어요. URL을 직접 입력해 주세요.'
      : urls.length > 1 ? '여러 링크 중 첫 번째를 선택했어요. 저장할 URL을 확인해 주세요.' : '',
  }
}

export function acceptIncomingShare(): string {
  if (window.location.pathname === '/share') {
    const payload = normalizeShare(new URLSearchParams(window.location.search))
    const id = crypto.randomUUID()
    sessionStorage.setItem(pendingKey, JSON.stringify({payload, id, createdAt: Date.now()}))
    // Remove the external URL/text from the visible address and browser history entry.
    history.replaceState(null, '', '/references/new?shared=' + id)
  }
  return window.location.pathname + window.location.search
}

export function pendingShare(id?: string): SharedReference | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null')
    if (!value || typeof value.createdAt !== 'number' || Date.now() - value.createdAt > expiryMs
      || value.createdAt > Date.now() || !value.payload) {clearPendingShare(); return null}
    const payload = value.payload
    if (id && value.id !== id) return null
    if (![payload.url, payload.title, payload.note, payload.warning].every(item => typeof item === 'string')) return null
    return {url: webUrl(payload.url) ?? '', title: payload.title.slice(0, 200), note: payload.note.slice(0, 5000), warning: payload.warning.slice(0, 300)}
  } catch {clearPendingShare(); return null}
}
export function clearPendingShare() { sessionStorage.removeItem(pendingKey) }
export function pendingShareRoute() {
  if (!pendingShare()) return null
  try {return '/references/new?shared=' + encodeURIComponent(JSON.parse(sessionStorage.getItem(pendingKey)!).id)} catch {return null}
}

export function bookmarklet(origin: string) {
  const collector = new URL('/share', origin).href
  const source = `(()=>{const target=new URL(${JSON.stringify(collector)});const page=new URL(location.href);if(['http:','https:'].includes(page.protocol)&&!page.username&&!page.password&&location.href.length<=4096){target.searchParams.set('url',location.href);target.searchParams.set('title',document.title.slice(0,200));target.searchParams.set('text',String(window.getSelection()||'').slice(0,1000))}if(target.href.length>7500)target.searchParams.delete('text');if(target.href.length>7500)target.searchParams.delete('title');if(target.href.length>7500)target.searchParams.delete('url');window.open(target.href,'_blank','noopener,noreferrer')})()`
  return 'javascript:' + encodeURIComponent(source)
}
