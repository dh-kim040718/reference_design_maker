import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

function worker(fetcher) {
  const events = new Map()
  const cached = []
  const self = {location: {origin: 'https://app.example.com'}, addEventListener: (name, handler) => events.set(name, handler), skipWaiting: async () => {}}
  vm.runInNewContext(readFileSync(new URL('../frontend/public/sw.js', import.meta.url), 'utf8'), {
    self, URL, Response, fetch: fetcher,
    caches: {match: async url => url === '/offline.html' ? new Response('Offline help') : undefined,
      open: async () => ({add: async url => cached.push(url)})},
  })
  return {events, cached}
}
test('offline navigation shows anonymous help and never intercepts account API requests', async () => {
  let fetches = 0
  const {events} = worker(async () => {fetches++; throw new TypeError('offline')})
  let response
  events.get('fetch')({request: {url: 'https://app.example.com/share?url=shared', method: 'GET', mode: 'navigate'}, respondWith: promise => {response = promise}})
  assert.equal(await (await response).text(), 'Offline help')
  response = undefined
  events.get('fetch')({request: {url: 'https://app.example.com/api/v1/projects', method: 'GET', mode: 'cors'}, respondWith: promise => {response = promise}})
  assert.equal(response, undefined)
  assert.equal(fetches, 1)
})
test('installation caches only the anonymous help document', async () => {
  const {events, cached} = worker(async () => new Response('ok'))
  let installation
  events.get('install')({waitUntil: promise => {installation = promise}})
  await installation
  assert.deepEqual(cached, ['/offline.html'])
})
