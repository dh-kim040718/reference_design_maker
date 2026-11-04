import { test } from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import { appOrigin, captureUrl } from './capture.js'

test('installed app and extension target the same safe confirmation endpoint', () => {
  const manifest = JSON.parse(readFileSync(new URL('../frontend/public/manifest.webmanifest', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.share_target, {action: '/share', method: 'GET', enctype: 'application/x-www-form-urlencoded', params: {title: 'title', text: 'text', url: 'url'}})
  assert.deepEqual(manifest.icons.filter(item => item.purpose === 'any').map(item => item.sizes), ['192x192', '512x512'])
  assert.ok(manifest.icons.some(item => item.purpose === 'maskable' && item.sizes === '512x512'))
})

test('captures the exact page URL including queries and fragments', () => {
  const source = 'https://example.com/design?view=a&other=b#hero'
  const url = new URL(captureUrl('http://127.0.0.1:5174', {url: source, title: '한글 제목'}))
  assert.equal(url.pathname, '/share')
  assert.equal(url.searchParams.get('url'), source)
  assert.equal(url.searchParams.get('title'), '한글 제목')
})
test('restricted pages fall back to manual entry without exposing their URLs', () => {
  for (const value of ['chrome://settings', 'file:///private/file', 'javascript:alert(1)', 'invalid']) {
    assert.equal(new URL(captureUrl('https://app.example.com', {url: value})).search, '')
  }
})
test('rejects unsafe or ambiguous app destinations', () => {
  for (const value of ['javascript:alert(1)', 'http://external.example', 'https://u:p@app.example', 'https://app.example/redirect?to=elsewhere']) {
    assert.throws(() => appOrigin(value))
  }
  assert.equal(appOrigin('https://app.example.com/'), 'https://app.example.com')
})

test('passes a bounded HTTPS preview in the fragment while preserving the source URL', () => {
  const source = 'https://example.com/design?view=a#hero'
  const target = new URL(captureUrl('https://app.example.com', {url: source, title: 'Title'}, 'https://i.pinimg.com/736x/cover.jpg'))
  assert.equal(target.searchParams.get('url'), source)
  assert.equal(target.searchParams.has('preview'), false)
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('preview'), 'https://i.pinimg.com/736x/cover.jpg')
  for (const preview of ['javascript:alert(1)', 'data:image/png;base64,x', 'http://example.com/x.png', 'https://u:p@example.com/x.png']) {
    assert.equal(new URL(captureUrl('https://app.example.com', {url: source}, preview)).hash, '')
  }
  const long = new URL(captureUrl('https://app.example.com', {url: 'https://example.com/' + '가'.repeat(1000)}, 'https://example.com/' + '가'.repeat(1000)))
  assert.ok(long.href.length <= 7500)
})
