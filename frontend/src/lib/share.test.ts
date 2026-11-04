import {afterEach, describe, expect, it, vi} from 'vitest'
import {acceptIncomingShare, bookmarklet, clearPendingShare, normalizeShare, pendingShare, pendingShareRoute, webUrl} from './share'

afterEach(() => {clearPendingShare(); history.replaceState(null, '', '/'); vi.useRealTimers()})
describe('shared reference intake', () => {
  it('keeps the extension preview through intake and clears it from the visible address', () => {
    history.replaceState(null, '', '/share?url=https%3A%2F%2Fexample.com#preview=https%3A%2F%2Fi.pinimg.com%2Fcover.jpg')
    const route = acceptIncomingShare()
    expect(route).not.toContain('pinimg')
    expect(location.hash).toBe('')
    expect(pendingShare()?.previewUrl).toBe('https://i.pinimg.com/cover.jpg')
    expect(normalizeShare(new URLSearchParams({url: 'https://example.com', preview: 'javascript:alert(1)'})).previewUrl).toBeUndefined()
  })
  it('accepts a small generated JPEG thumbnail and preserves the collector version', () => {
    const jpeg = 'data:image/jpeg;base64,/9j/AA=='
    history.replaceState(null, '', '/share?' + new URLSearchParams({url:'https://example.com',collector:'extension-0.3.0'}) + '#' + new URLSearchParams({preview:jpeg}))
    acceptIncomingShare()
    expect(pendingShare()?.previewUrl).toBe(jpeg)
    expect(pendingShare()?.collectorVersion).toBe('0.3.0')
    expect(location.hash).toBe('')
    expect(normalizeShare(new URLSearchParams({url:'https://example.com',preview:'data:image/svg+xml,<svg/>'})).previewUrl).toBeUndefined()
  })
  it('preserves a URL query and fragment without decoding it twice', () => {
    const url = 'https://example.com/design?a=1&next=%2Fpath#hero'
    expect(normalizeShare(new URLSearchParams({url})).url).toBe(url)
  })
  it('extracts links from text and preserves selected text as an editable note', () => {
    expect(normalizeShare(new URLSearchParams({title: 'Reference', text: '여백을 참고 https://example.com/design'})))
      .toEqual({url: 'https://example.com/design', title: 'Reference', note: '여백을 참고', warning: ''})
  })
  it('does not let malformed or unsafe links interrupt manual input', () => {
    for (const url of ['javascript:alert(1)', 'file:///private', 'https://u:p@example.com', 'invalid']) {
      expect(webUrl(url)).toBeNull()
      expect(normalizeShare(new URLSearchParams({url})).warning).toContain('URL을 직접 입력')
    }
  })
  it('recovers from an invalid URL field when the text contains a valid link', () => {
    expect(normalizeShare(new URLSearchParams({url: 'invalid', text: 'https://example.com'})).url).toBe('https://example.com')
  })
  it('warns about multiple links and caps optional fields', () => {
    const result = normalizeShare(new URLSearchParams({title: '가'.repeat(500), text: 'https://a.example https://b.example ' + '나'.repeat(9000)}))
    expect(result.warning).toContain('첫 번째')
    expect(result.title).toHaveLength(200)
    expect(result.note).toHaveLength(5000)
  })
  it('stores a temporary intake across login while removing shared text from the address', () => {
    history.replaceState(null, '', '/share?' + new URLSearchParams({url: 'https://example.com', title: 'Title'}))
    const route = acceptIncomingShare()
    expect(route).toMatch(/^\/references\/new\?shared=/)
    expect(route).not.toContain('example.com')
    expect(pendingShare()?.url).toBe('https://example.com')
    expect(pendingShareRoute()).toBe(route)
    expect(pendingShare('different-intake')).toBeNull()
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 16 * 60 * 1000)
    expect(pendingShare()).toBeNull()
  })
  it('generates a bookmarklet with a fixed destination and isolated new window', () => {
    const source = decodeURIComponent(bookmarklet('https://app.example.com').slice('javascript:'.length))
    expect(source).toContain('https://app.example.com/share')
    expect(source).toContain('noopener,noreferrer')
    expect(source).toContain('document.title')
  })
  it('keeps a long selection within a navigable handoff URL and excludes credential URLs', () => {
    const source = decodeURIComponent(bookmarklet('https://app.example.com').slice('javascript:'.length))
    const open = vi.fn()
    const run = new Function('window', 'location', 'document', source)
    run({open, getSelection: () => '나'.repeat(9000)}, {href: 'https://example.com/design?one=1#hero'}, {title: '제목'.repeat(100)})
    const target = new URL(open.mock.calls[0][0])
    expect(target.href.length).toBeLessThanOrEqual(7500)
    expect(target.searchParams.get('url')).toBe('https://example.com/design?one=1#hero')
    open.mockClear()
    run({open, getSelection: () => ''}, {href: 'https://username:password@example.com/private'}, {title: 'Private'})
    expect(new URL(open.mock.calls[0][0]).search).toBe('')
  })
})
