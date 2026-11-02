// Windows smoke check using installed Chrome/Edge and the DevTools protocol.
// Requires the local test account from backend/tests/prepare_browser_user.py.
import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const folder = path.join(root, '.phase2-checks')
const account = JSON.parse(await readFile(path.join(folder, 'account.json'), 'utf8'))
const url = process.env.SMOKE_URL ?? 'http://127.0.0.1:5174'
const browser = process.argv[2] ?? 'chrome'
const projectName = `브라우저 검증 ${browser} ${Date.now()}`
const executable = browser === 'edge' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = browser === 'edge' ? 9323 : 9322
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
await mkdir(folder, {recursive: true})
const child = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(folder, browser + '-profile-' + Date.now())}`, 'about:blank'], {windowsHide: true, stdio: 'ignore'})
let socket
let count = 0
const pending = new Map()
const errors = []
async function command(method, params = {}) {
  const id = ++count
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {pending.delete(id); reject(new Error('DevTools timeout: ' + method))}, 10000)
    pending.set(id, {resolve: value => {clearTimeout(timer); resolve(value)}, reject})
  })
  socket.send(JSON.stringify({id, method, params}))
  return promise
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true})
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {if (await evaluate(expression)) return; await sleep(100)}
  throw new Error('Condition timed out: ' + expression + '\n' + await evaluate('document.body.innerText'))
}
async function click(text) {
  await until(`[...document.querySelectorAll('button,a')].some(x=>x.textContent.trim()===${JSON.stringify(text)} && !x.disabled)`)
  await evaluate(`[...document.querySelectorAll('button,a')].find(x=>x.textContent.trim()===${JSON.stringify(text)} && !x.disabled).click()`)
}
async function fill(selector, value) {
  await evaluate(`(()=>{const x=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(${selector.includes('textarea') ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set.call(x,${JSON.stringify(value)});x.dispatchEvent(new Event('input',{bubbles:true}));})()`)
}
async function screenshot(name) {
  const result = await command('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true})
  await writeFile(path.join(folder, `${browser}-${name}.png`), Buffer.from(result.data, 'base64'))
}
try {
  let targets
  for (let i = 0; i < 100; i++) {
    try {targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()); break} catch {await sleep(100)}
  }
  if (!targets) throw new Error('Headless browser did not start.')
  socket = new WebSocket(targets.find(x => x.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {socket.onopen = resolve; socket.onerror = reject})
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) {const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(new Error(message.error.message)); else item?.resolve(message.result)}
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
    if (message.method === 'Page.javascriptDialogOpening') command('Page.handleJavaScriptDialog', {accept: true}).catch(() => {})
    if (message.method === 'Fetch.requestPaused' && message.params.request.url.startsWith('https://share-source.example.test/')) {
      const body = Buffer.from('<!doctype html><html><head><title>브라우저 공유 테스트</title></head><body><h1>External reference fixture</h1></body></html>').toString('base64')
      command('Fetch.fulfillRequest', {requestId: message.params.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: 'text/html; charset=utf-8'}], body}).catch(() => {})
    }
  }
  await command('Runtime.enable'); await command('Page.enable')
  await command('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false})
  const loginShare = new URL('/share', url)
  loginShare.searchParams.set('url', 'https://example.com/shared-before-login')
  loginShare.searchParams.set('title', '로그인 후 돌아올 공유 링크')
  await command('Page.navigate', {url: process.argv.includes('--share') ? loginShare.href : url})
  if (process.argv.includes('--manifest-only')) {
    await until("document.readyState==='complete'")
    const manifest = await command('Page.getAppManifest')
    console.log(JSON.stringify({errors: manifest.errors, share_target: JSON.parse(manifest.data || '{}').share_target}))
  } else {
  await until("!!document.querySelector('input[type=email]')")
  await screenshot('login')
  if (process.argv.includes('--signup')) {
    await click('회원가입')
    await until("document.body.innerText.includes('비밀번호 확인')")
    await fill('input[type=email]', `phase2-signup-${browser}-${Date.now()}@example.com`)
    await fill('input[type=password]', account.password)
    await fill('label:last-of-type input', account.password)
    await screenshot('signup')
    await click('회원가입')
  } else {
    await fill('input[type=email]', account.email); await fill('input[type=password]', account.password); await click('로그인')
  }
  if (process.argv.includes('--share')) {
    await until("document.querySelector('input[name=source_url]')?.value==='https://example.com/shared-before-login'")
    await screenshot('share-after-login')
    await evaluate("document.querySelector('a.brand').click()")
  }
  await click('＋ 프로젝트 만들기')
  await fill('dialog input', projectName); await click('저장')
  await click(projectName)
  await click('＋ 산출물 유형 추가'); await fill('dialog input', '웹사이트'); await click('저장')
  await click('웹사이트'); await click('＋ 레퍼런스 추가')
  await until("!!document.querySelector('input[name=source_url]')")
  await fill('input[name=source_url]', 'https://example.com/design?view=full#hero')
  if (process.argv.includes('--thumbnail')) {
    const thumbnail = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=640;c.height=400;const x=c.getContext('2d');x.fillStyle='#e4eade';x.fillRect(0,0,640,400);x.fillStyle='#365c43';x.fillRect(24,24,140,352);x.fillStyle='#fff';x.fillRect(184,24,432,74);x.fillRect(184,118,204,120);x.fillRect(408,118,208,120);x.fillRect(184,258,432,118);return c.toDataURL('image/png').split(',')[1]})()`)
    const filename = path.join(folder, 'thumbnail-upload.png')
    await writeFile(filename, Buffer.from(thumbnail, 'base64'))
    if (process.argv.includes('--paste-thumbnail')) {
      await evaluate(`(()=>{const bytes=Uint8Array.from(atob(${JSON.stringify(thumbnail)}),x=>x.charCodeAt(0));const file=new File([bytes],'clipboard.png',{type:'image/png'});const data=new DataTransfer();data.items.add(file);window.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));})()`)
    } else {
      await command('DOM.enable')
      const doc = await command('DOM.getDocument')
      const input = await command('DOM.querySelector', {nodeId: doc.root.nodeId, selector: 'input[type=file]'})
      await command('DOM.setFileInputFiles', {nodeId: input.nodeId, files: [filename]})
    }
    await until("!!document.querySelector('.capture-preview img')?.naturalWidth")
  }
  await screenshot('create')
  await click('레퍼런스 저장')
  await until("document.body.innerText.includes('레퍼런스를 저장했습니다.')")
  await until("[...document.querySelectorAll('a')].some(x=>x.textContent==='example.com')")
  await screenshot('references'); await click('example.com'); await click('메모 수정')
  await fill('textarea', '큰 제목과 여백을 참고합니다.'); await click('메모 저장')
  await until("document.body.innerText.includes('큰 제목과 여백을 참고합니다.') && !document.querySelector('textarea')")
  await until("!!document.querySelector('.reference-rail .rail-item')")
  await screenshot('detail')
  await command('Page.reload')
  await until("document.body.innerText.includes('큰 제목과 여백을 참고합니다.')")
  if (process.argv.includes('--thumbnail')) await until("!!document.querySelector('.inspector-image img')?.naturalWidth")
  if (process.argv.includes('--generation')) {
    await click('AI 시안 만들기 →')
    await until("document.body.innerText.includes('유료 API 사용 승인 대기')")
    if (!await evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent==='AI 시안 1장 생성')?.disabled")) throw new Error('Paid generation gate is not disabled')
    if (process.argv.includes('--thumbnail')) {
      await click('저장된 미리보기 사용')
      await evaluate("document.querySelector('.region-prototype').open=true")
      await until("!!document.querySelector('.region-stage img')?.naturalWidth")
      for (const [index, value] of ['10', '20', '30', '40'].entries()) await fill(`.region-fields label:nth-of-type(${index + 1}) input`, value)
      await evaluate("window.savedAnchorClick=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.exportedMask=this.href}")
      await click('마스크 PNG 다운로드')
      const mask = await evaluate("(async()=>{const img=new Image();img.src=window.exportedMask;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);return {width:img.width,height:img.height,inside:x.getImageData(Math.floor(img.width*.2),Math.floor(img.height*.3),1,1).data[3],outside:x.getImageData(0,0,1,1).data[3],sourceWidth:document.querySelector('.region-stage img').naturalWidth,sourceHeight:document.querySelector('.region-stage img').naturalHeight}})()")
      await evaluate('HTMLAnchorElement.prototype.click=window.savedAnchorClick')
      if (mask.width !== mask.sourceWidth || mask.height !== mask.sourceHeight || mask.inside !== 0 || mask.outside !== 255) throw new Error('Invalid original-size region mask')
      await click('선택 영역 편집 준비')
      await until("document.body.innerText.includes('영역 편집 연동·품질 검증 대기 중입니다.')")
      if (!await evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent==='선택 영역 1회 편집')?.disabled")) throw new Error('Editing gate is not disabled')
    }
    await screenshot('generation-disabled')
    await command('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true})
    await screenshot('generation-mobile')
    if (await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Generation mobile overflow')
    await click('← 레퍼런스로')
    await until("!!document.querySelector('.inspector')")
  }
  if (process.argv.includes('--share')) {
    await click('외부에서 저장')
    await until("!!document.querySelector('.bookmarklet-button')?.getAttribute('href')")
    await screenshot('collect')
    const manifest = await command('Page.getAppManifest')
    if (manifest.errors?.some(error=>error.critical) || JSON.parse(manifest.data).share_target.action !== '/share') throw new Error('Invalid share-target manifest')
    await evaluate('navigator.serviceWorker.ready.then(registration=>!!registration.active)')
    if (!await evaluate("fetch('/reference-maker-extension.zip').then(r=>r.arrayBuffer()).then(b=>b.byteLength>1000)")) throw new Error('Missing collector package')
    const bookmark = await evaluate("document.querySelector('.bookmarklet-button').getAttribute('href')")
    await command('Fetch.enable', {patterns: [{urlPattern: 'https://share-source.example.test/*', resourceType: 'Document', requestStage: 'Request'}]})
    await command('Page.navigate', {url: 'https://share-source.example.test/reference?view=full#hero'})
    await until("document.title==='브라우저 공유 테스트'")
    await evaluate(decodeURIComponent(bookmark.slice('javascript:'.length)))
    let collector
    for (let i=0; i<100; i++) {
      const targets = await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json())
      collector = targets.find(target=>target.type==='page' && target.url.startsWith(new URL('/references/new?shared=', url).href))
      if (collector) break
      await sleep(100)
    }
    if (!collector) throw new Error('Bookmarklet did not open the collector tab')
    const previous = socket
    const handler = socket.onmessage
    socket = new WebSocket(collector.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
    socket.onmessage = handler
    previous.close()
    await command('Runtime.enable'); await command('Page.enable')
    await until("document.querySelector('input[name=source_url]')?.value==='https://share-source.example.test/reference?view=full#hero'")
    await until("document.querySelector('select[name=deliverable_type_id]')?.value!==''")
    if (await evaluate("!!document.querySelector('input[type=email]')")) throw new Error('Login was not shared with the collector tab')
    if (await evaluate("document.querySelector('input[name=title]').value") !== '브라우저 공유 테스트') throw new Error('Shared title was lost')
    await screenshot('share-confirmation')
    await click('레퍼런스 저장')
    await until("document.body.innerText.includes('레퍼런스를 저장했습니다.')")
    await click('브라우저 공유 테스트')
    await until("!!document.querySelector('.inspector')")
  }
  await command('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true})
  await screenshot('mobile-detail')
  if (await evaluate('document.documentElement.scrollWidth > innerWidth')) throw new Error('Mobile horizontal overflow')
  await click('로그아웃'); await until("!!document.querySelector('input[type=email]')")
  if (errors.length) throw new Error('Uncaught browser exceptions: ' + errors.join(', '))
  console.log(`${browser}: login → project → type → URL save → note edit → reload${process.argv.includes('--share') ? ' → incoming share → bookmarklet → new collector tab → confirmed save → manifest/service worker' : ''} → mobile → logout passed`)
  }
} finally {
  if (socket?.readyState === 1) {await command('Browser.close').catch(() => {}); socket.close()}
  child.kill()
}
