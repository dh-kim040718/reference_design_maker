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
  await until(`[...document.querySelectorAll('button,a,summary')].some(x=>x.textContent.trim()===${JSON.stringify(text)} && !x.disabled)`)
  await evaluate(`[...document.querySelectorAll('button,a,summary')].find(x=>x.textContent.trim()===${JSON.stringify(text)} && !x.disabled).click()`)
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
      if (message.params.request.url.endsWith('/cover.png')) {
        readFile(path.join(folder, 'thumbnail-upload.png')).then(bytes => command('Fetch.fulfillRequest', {requestId: message.params.requestId, responseCode: 200, responseHeaders: [{name:'Content-Type',value:'image/png'}], body:bytes.toString('base64')})).catch(() => {})
      } else {
        const body = Buffer.from('<!doctype html><html><head><title>브라우저 공유 테스트</title><meta property="og:image" content="https://share-source.example.test/cover.png"></head><body><h1>External reference fixture</h1></body></html>').toString('base64')
        command('Fetch.fulfillRequest', {requestId: message.params.requestId, responseCode: 200, responseHeaders: [{name: 'Content-Type', value: 'text/html; charset=utf-8'}], body}).catch(() => {})
      }
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
  await until(`[...document.querySelectorAll('.project-card')].some(card=>card.innerText.includes(${JSON.stringify(projectName)})&&card.innerText.includes('아직 레퍼런스가 없어요'))`)
  await screenshot('project-cards')
  await click(projectName)
  await click('분류 관리'); await click('＋ 분류 추가'); await fill('dialog input', '웹사이트'); await click('저장')
  await click('웹사이트'); await click('＋ 레퍼런스 추가')
  await until("!!document.querySelector('input[name=source_url]')")
  await fill('input[name=source_url]', 'https://example.com/design?view=full#hero')
  if (process.argv.includes('--thumbnail')) {
    const thumbnail = await evaluate(`(()=>{const c=document.createElement('canvas');c.width=${process.argv.includes('--portrait-guidance') ? 360 : 640};c.height=${process.argv.includes('--portrait-guidance') ? 780 : 400};const x=c.getContext('2d');x.fillStyle='#e4eade';x.fillRect(0,0,640,400);x.fillStyle='#365c43';x.fillRect(24,24,140,352);x.fillStyle='#fff';x.fillRect(184,24,432,74);x.fillRect(184,118,204,120);x.fillRect(408,118,208,120);x.fillRect(184,258,432,118);return c.toDataURL('image/png').split(',')[1]})()`)
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
  if (process.argv.includes('--guidance')) {
    await click('참고 요소 지정')
    await evaluate("[...document.querySelectorAll('.guidance-role-options label')].find(x=>x.textContent==='컬러').querySelector('input').click()")
    await until("!!document.querySelector('.guidance-canvas img')?.naturalWidth")
    await evaluate("document.querySelector('.guidance-canvas').scrollIntoView({block:'center'})")
    const bounds = await evaluate("(()=>{const r=document.querySelector('.guidance-canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()")
    await command('Input.dispatchMouseEvent', {type:'mousePressed', x:bounds.x+bounds.w*.1, y:bounds.y+bounds.h*.2, button:'left', clickCount:1})
    await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:bounds.x+bounds.w*.7, y:bounds.y+bounds.h*.6, button:'left', buttons:1})
    await command('Input.dispatchMouseEvent', {type:'mouseReleased', x:bounds.x+bounds.w*.7, y:bounds.y+bounds.h*.6, button:'left', clickCount:1})
    await command('Input.dispatchMouseEvent', {type:'mousePressed', x:bounds.x+bounds.w*.4, y:bounds.y+bounds.h*.4, button:'left', clickCount:1})
    await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:bounds.x+bounds.w*.45, y:bounds.y+bounds.h*.45, button:'left', buttons:1})
    await command('Input.dispatchMouseEvent', {type:'mouseReleased', x:bounds.x+bounds.w*.45, y:bounds.y+bounds.h*.45, button:'left', clickCount:1})
    await until("Math.abs(Number(document.querySelector('[aria-label=\"영역 1 x\"]').value)-15)<1 && Math.abs(Number(document.querySelector('[aria-label=\"영역 1 y\"]').value)-25)<1")
    const handle = await evaluate("(()=>{const r=document.querySelector('.guidance-resize-handle.se').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()")
    await command('Input.dispatchMouseEvent', {type:'mousePressed', x:handle.x, y:handle.y, button:'left', clickCount:1})
    await command('Input.dispatchMouseEvent', {type:'mouseMoved', x:bounds.x+bounds.w*.9, y:bounds.y+bounds.h*.8, button:'left', buttons:1})
    await command('Input.dispatchMouseEvent', {type:'mouseReleased', x:bounds.x+bounds.w*.9, y:bounds.y+bounds.h*.8, button:'left', clickCount:1})
    await until("Number(document.querySelector('[aria-label=\"영역 1 width\"]').value)>70 && Number(document.querySelector('[aria-label=\"영역 1 height\"]').value)>50 && document.querySelectorAll('.guidance-region-editor').length===1")
    await fill('.guidance-region-editor textarea', '그래프의 여백과 배치를 참고합니다.')
    await screenshot('reference-guidance-editor')
    await evaluate("document.querySelector('.guidance-region-editor details').open=true")
    await screenshot('reference-guidance-precision')
    await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true})
    await screenshot('reference-guidance-mobile')
    if (await evaluate('document.documentElement.scrollWidth>innerWidth+1')) throw new Error('Guidance editor overflows on mobile')
    await command('Emulation.setDeviceMetricsOverride', {width:1440,height:1000,deviceScaleFactor:1,mobile:false})
    await click('참고 요소 저장')
    await until("!document.querySelector('.reference-guidance form') && document.querySelector('.reference-guidance')?.innerText.includes('영역 메모 1개')")
    await command('Page.reload')
    await until("document.querySelector('.reference-guidance')?.innerText.includes('그래프의 여백과 배치를 참고합니다.')")
    await screenshot('reference-guidance-saved')
  }
  await command('Page.reload')
  await until("document.body.innerText.includes('큰 제목과 여백을 참고합니다.')")
  if (process.argv.includes('--thumbnail')) await until("!!document.querySelector('.inspector-image img')?.naturalWidth")
  if (process.argv.includes('--generation')) {
    const detailUrl = await evaluate('location.href')
    if (await evaluate("!!document.querySelector('.generation-entry')")) throw new Error('Reference-scoped generation entry remains')
    await evaluate("document.querySelector('.reference-location a').click()")
    await click('분류 관리'); await click('＋ 분류 추가'); await fill('dialog input', '차트 검증'); await click('저장')
    await click('차트 검증'); await click('＋ 레퍼런스 추가')
    await until("!!document.querySelector('input[name=source_url]')")
    await fill('input[name=source_url]', 'https://example.com/chart')
    await fill('textarea[name=design_note]', '차트 막대 표현을 참고합니다.')
    if (process.argv.includes('--thumbnail')) {
      const doc = await command('DOM.getDocument')
      const input = await command('DOM.querySelector', {nodeId:doc.root.nodeId, selector:'input[type=file]'})
      await command('DOM.setFileInputFiles', {nodeId:input.nodeId,files:[path.join(folder,'thumbnail-upload.png')]})
      await until("!!document.querySelector('.capture-preview img')?.naturalWidth")
    }
    await click('레퍼런스 저장')
    await until("document.body.innerText.includes('레퍼런스를 저장했습니다.')")
    await click('전체')
    await click('프로젝트 시안 만들기 →')
    await until("document.body.innerText.includes('검토할 전체 레퍼런스 · 2개')")
    if (process.argv.includes('--guidance')) await until("[...document.querySelectorAll('.concept-inputs .guidance-summary')].some(x=>x.innerText.includes('컬러') && x.innerText.includes('영역 메모 1개'))")
    if (!await evaluate("document.body.innerText.includes('큰 제목과 여백을 참고합니다.') && document.body.innerText.includes('차트 막대 표현을 참고합니다.')")) throw new Error('Cross-classification notes missing')
    await fill('textarea[maxlength="5000"]', '데스크톱 대시보드: 전체 배치와 차트를 종합해 주세요.')
    if (process.argv.includes('--design-settings')) {
      await evaluate("document.querySelector('.design-purpose-trigger').click()")
      await until("!!document.querySelector('.design-purpose-option[data-value=poster]')")
      await screenshot('design-purpose-presets')
      await evaluate("document.querySelector('.design-purpose-option[data-value=poster]').click()")
      await until("!!document.querySelector('.design-ppi input')")
      await fill('.design-dimensions label:first-child input','210')
      await fill('.design-dimensions label:nth-child(2) input','297')
      await until("document.querySelector('.design-output-preview')?.innerText.includes('2,480 × 3,508')")
    }
    if (await evaluate("[...document.querySelectorAll('button')].some(x=>x.textContent==='요구사항 저장')")) throw new Error('Separate requirements save step remains')
    if (process.argv.includes('--thumbnail')) {
      await until("document.querySelectorAll('.concept-image img').length===2")
      await evaluate("document.querySelectorAll('.concept-card-select input')[0].click()")
      await until("document.querySelector('input[aria-label=\"레퍼런스 전체 선택\"]').indeterminate")
      await click('전체 해제')
      await until("[...document.querySelectorAll('.concept-card-select input')].every(x=>!x.checked)")
      await evaluate("document.querySelector('input[aria-label=\"레퍼런스 전체 선택\"]').click()")
      await until("[...document.querySelectorAll('.concept-card-select input')].every(x=>x.checked)")
      await until("[...document.querySelectorAll('.concept-reference')].every(card=>{const image=card.querySelector('.concept-image').getBoundingClientRect();const title=card.querySelector('.concept-reference-title').getBoundingClientRect();return image.width>=card.clientWidth-28&&title.top>=image.bottom})")
      if (await evaluate("[...document.querySelectorAll('button')].some(x=>x.textContent==='저장된 미리보기 모두 사용')")) throw new Error('Manual image preparation remains')
    }
    if (!await evaluate("[...document.querySelectorAll('button')].find(x=>x.textContent==='프로젝트 시안 1장 만들기')?.disabled")) throw new Error('Project paid gate is not disabled')
    await screenshot('project-generation-disabled')
    await command('Emulation.setDeviceMetricsOverride', {width:390,height:844,deviceScaleFactor:1,mobile:true})
    await screenshot('project-generation-mobile')
    if (process.argv.includes('--design-settings')) {
      await evaluate("document.querySelector('.design-purpose-trigger').click()")
      await until("!!document.querySelector('.design-purpose-popover')")
      await screenshot('design-purpose-presets-mobile')
      if(await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Purpose preset picker mobile overflow')
      await evaluate("document.querySelector('.design-purpose-trigger').click()")
    }
    if (await evaluate('document.documentElement.scrollWidth>innerWidth')) throw new Error('Project generation mobile overflow')
    await command('Page.navigate', {url:detailUrl})
    await until("!!document.querySelector('.inspector')")
  }
  if (process.argv.includes('--extension-preview')) {
    const {readPagePreview, makePageThumbnail} = await import('../browser-extension/page-preview.js')
    const {captureUrl} = await import('../browser-extension/capture.js')
    await command('Fetch.enable', {patterns:[{urlPattern:'https://share-source.example.test/*',requestStage:'Request'}]})
    await command('Page.navigate', {url:'https://share-source.example.test/reference?view=full#hero'})
    await until("document.title==='브라우저 공유 테스트'")
    const page = await evaluate(`(${readPagePreview.toString()})()`)
    if (page.preview !== 'https://share-source.example.test/cover.png') throw new Error('Page preview extraction failed')
    const inline = await evaluate(`(${makePageThumbnail.toString()})(${JSON.stringify(page.preview)})`)
    if (!inline.startsWith('data:image/jpeg;base64,/9j/')) throw new Error('Automatic thumbnail conversion failed')
    await command('Page.navigate', {url:captureUrl(new URL(url).origin,page,inline)})
    await until("!!document.querySelector('.capture-preview img')?.naturalWidth")
    await until("!!document.querySelector('select[name=deliverable_type_id]')?.value")
    await screenshot('extension-auto-preview')
    if (await evaluate("location.hash!=='' || document.querySelector('input[name=source_url]').value!=='https://share-source.example.test/reference?view=full#hero'")) throw new Error('Incorrect extension intake')
    await click('레퍼런스 저장')
    await until("document.body.innerText.includes('레퍼런스를 저장했습니다.')")
    await click('브라우저 공유 테스트')
    await until("!!document.querySelector('.inspector-image img')?.naturalWidth")
    await screenshot('extension-preview-saved')
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
