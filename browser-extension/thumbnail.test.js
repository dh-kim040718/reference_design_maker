import {test} from 'node:test'
import assert from 'node:assert/strict'
import {cropThumbnail, thumbnailData} from './thumbnail.js'
import {captureUrl} from './capture.js'

test('only bounded JPEG thumbnails enter the inline handoff', () => {
  const jpeg = 'data:image/jpeg;base64,/9j/AA=='
  assert.equal(thumbnailData(jpeg), jpeg)
  for (const value of ['data:image/svg+xml,<svg/>', 'data:text/html,x', 'data:image/jpeg;base64,notjpeg', 'data:image/jpeg;base64,/9j/' + 'a'.repeat(160000)]) assert.equal(thumbnailData(value), '')
  const target = new URL(captureUrl('https://app.example.com', {url: 'https://example.com/pin'}, jpeg))
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('preview'), jpeg)
  assert.equal(target.searchParams.get('collector'), 'extension-0.3.0')
})

test('crops only the requested image rectangle and accounts for screenshot pixel density', async () => {
  let pixels, closed = false
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = async () => ({blob: async () => new Blob()})
  globalThis.createImageBitmap = async () => ({width:1600, height:1200, close: () => {closed = true}})
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {assert.equal(width, 200); assert.equal(height, 300); this.width=width; this.height=height}
    getContext() {return {drawImage: (...args) => {pixels = args.slice(1)}}}
    async convertToBlob() {return new Blob([new Uint8Array([255,216,255,0])])}
  }
  try {
    const crop = {x:100, y:50, width:200, height:300, viewport:{width:800,height:600}}
    assert.ok((await cropThumbnail('data:image/png;base64,xxx', crop)).startsWith('data:image/jpeg;base64,/9j/'))
    assert.deepEqual(pixels, [200,100,400,600,0,0,200,300])
    assert.equal(closed, true)
    assert.equal(await cropThumbnail('', {...crop, x:700}), '')
  } finally {globalThis.fetch = fetchOriginal; delete globalThis.createImageBitmap; delete globalThis.OffscreenCanvas}
})
