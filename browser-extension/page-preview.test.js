import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readPagePreview} from './page-preview.js'

function page(url, selectors) {
  globalThis.location = new URL(url)
  globalThis.document = {title: 'Page title', querySelector: selector => selectors[selector] || null, querySelectorAll: selector => selectors[selector] || []}
  return readPagePreview()
}

test('extracts metadata and resolves relative HTTPS images', () => {
  assert.equal(page('https://example.com/design', {'meta[property="og:image"]': {content: '/cover.jpg'}}).preview, 'https://example.com/cover.jpg')
  assert.equal(page('https://example.com/design', {}).preview, '')
  assert.equal(page('https://example.com/design', {'meta[name="twitter:image"]': {content: 'javascript:alert(1)'}}).preview, '')
})

test('prefers the opened Pinterest pin image over stale metadata, not related images', () => {
  const selector = '[data-test-id="pin-closeup-image"] img, img[data-test-id="pin-closeup-image"]'
  const result = page('https://kr.pinterest.com/pin/123456/', {
    [selector]: {currentSrc: 'https://i.pinimg.com/736x/current.jpg'},
    'meta[property="og:image"]': {content: 'https://i.pinimg.com/736x/old.jpg'},
  })
  assert.equal(result.preview, 'https://i.pinimg.com/736x/current.jpg')
  assert.equal(page('https://kr.pinterest.com/', {[selector]: {src: 'https://i.pinimg.com/related.jpg'}}).preview, '')
})

test('ignores avatars when falling back to Pinterest closeup content', () => {
  assert.equal(page('https://kr.pinterest.com/pin/123456/', {
    '[data-test-id="pin-closeup-body"] img': [
      {naturalWidth: 48, naturalHeight: 48, src: 'https://i.pinimg.com/avatar.jpg'},
      {naturalWidth: 736, naturalHeight: 1200, currentSrc: 'https://i.pinimg.com/reference.jpg'},
    ],
  }).preview, 'https://i.pinimg.com/reference.jpg')
})

test('finds the exact pin in page state when rendered selectors and metadata are absent', () => {
  const result = page('https://kr.pinterest.com/pin/1103170871240438444/', {
    'script[type="application/json"], script[type="application/ld+json"]': [{textContent: JSON.stringify({props: {pins: {
      'other': {images: {orig: {url: 'https://i.pinimg.com/related.jpg'}}},
      '1103170871240438444': {images: {orig: {url: 'https://i.pinimg.com/correct.jpg'}}},
    }}})}],
  })
  assert.equal(result.preview, 'https://i.pinimg.com/correct.jpg')
})
