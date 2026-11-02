import {test} from 'node:test'
import assert from 'node:assert/strict'

let click
let destination = 'http://127.0.0.1:5174'
const opened = []
let optionsOpened = 0
globalThis.chrome = {
  action: {onClicked: {addListener: callback => {click = callback}}, setBadgeText: async () => {}},
  storage: {local: {get: async () => ({appOrigin: destination})}},
  tabs: {create: async value => {opened.push(value)}},
  runtime: {openOptionsPage: async () => {optionsOpened++}},
}
await import('./worker.js')

test('toolbar action opens the app confirmation screen without saving data', async () => {
  await click({url: 'https://example.com/design', title: 'Reference'})
  const target = new URL(opened.at(-1).url)
  assert.equal(target.pathname, '/share')
  assert.equal(target.searchParams.get('url'), 'https://example.com/design')
  assert.equal(target.searchParams.get('title'), 'Reference')
})
test('toolbar handles missing tab URL with the manual fallback', async () => {
  await click({})
  assert.equal(opened.at(-1).url, 'http://127.0.0.1:5174/share')
})
test('invalid connection settings open options instead of forwarding page data', async () => {
  destination = 'javascript:alert(1)'
  const before = opened.length
  await click({url: 'https://example.com/private', title: 'Title'})
  assert.equal(opened.length, before)
  assert.equal(optionsOpened, 1)
})
