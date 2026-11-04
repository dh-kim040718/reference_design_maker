import {thumbnailData} from './thumbnail.js'
export const defaultOrigin = 'http://127.0.0.1:5174'

export function appOrigin(input) {
  const url = new URL(input)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('앱의 HTTPS 주소 또는 로컬 개발 주소를 입력해 주세요.')
  }
  return url.origin
}

export function captureUrl(origin, tab, preview = '') {
  const target = new URL('/share', appOrigin(origin))
  try {
    const source = new URL(tab.url)
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password || tab.url.length > 4096) return target.href
    target.searchParams.set('url', tab.url)
    target.searchParams.set('title', String(tab.title ?? '').slice(0, 200))
    target.searchParams.set('collector', 'extension-0.3.0')
    const inline = thumbnailData(preview)
    try {
      if (inline) target.hash = new URLSearchParams({preview: inline}).toString()
      else {
        const image = new URL(preview)
        if (image.protocol === 'https:' && !image.username && !image.password && image.href.length <= 4096) target.hash = new URLSearchParams({preview: image.href}).toString()
      }
    } catch { /* No usable page thumbnail. */ }
    if (target.href.length > (inline ? 220000 : 7500)) target.hash = ''
    const fragment = target.hash
    target.hash = ''
    if (target.href.length > 7500) target.searchParams.delete('title')
    if (target.href.length > 7500) target.searchParams.delete('url')
    if (target.searchParams.has('url')) target.hash = fragment
  } catch { /* Restricted tabs open the manual-input fallback. */ }
  return target.href
}
