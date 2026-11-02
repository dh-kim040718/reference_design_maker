// Read-only UI check by default. --delete explicitly verifies deletion after downloading a copy.
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browser = process.argv[2] || 'chrome'
const relative = process.argv[3] || 'approved-new-key-03'
const folder = path.resolve(root, '.phase4-checks', relative)
if (!folder.startsWith(path.join(root, '.phase4-checks') + path.sep)) throw new Error('Invalid report folder')
const report = JSON.parse(await readFile(path.join(folder, 'report.json'), 'utf8'))
const account = JSON.parse(await readFile(path.join(root, '.phase2-checks/account.json'), 'utf8'))
const url = process.env.SMOKE_URL || 'http://127.0.0.1:5174'
const executable = browser === 'edge' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const port = browser === 'edge' ? 9343 : 9342
const downloads = path.join(folder, `downloads-${browser}`)
await mkdir(downloads, {recursive:true})
const child = spawn(executable, ['--headless=new','--no-first-run','--disable-gpu',`--remote-debugging-port=${port}`,`--user-data-dir=${path.join(folder, 'profile-' + browser + '-' + Date.now())}`,'about:blank'], {windowsHide:true,stdio:'ignore'})
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms))
let socket, count=0
const pending = new Map()
const errors=[]
function command(method,params={}) {
  const id=++count
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('DevTools timeout: '+method))},15000)
    pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r)},reject})
    socket.send(JSON.stringify({id,method,params}))
  })
}
async function evaluate(expression) {
  const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true})
  if(result.exceptionDetails)throw new Error('Browser evaluation failed')
  return result.result.value
}
async function until(expression) {
  for(let n=0;n<100;n++){if(await evaluate(expression))return;await sleep(100)}
  throw new Error('Browser condition timed out')
}
async function click(text) {
  await until(`[...document.querySelectorAll('button,a')].some(e=>e.textContent.trim()===${JSON.stringify(text)})`)
  await evaluate(`[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`)
}
try {
  let targets
  for(let n=0;n<100;n++){try{targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json());break}catch{await sleep(100)}}
  socket=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  socket.onmessage=event=>{
    const message=JSON.parse(event.data)
    if(message.id){const item=pending.get(message.id);pending.delete(message.id);if(message.error)item?.reject(new Error('DevTools error'));else item?.resolve(message.result)}
    if(message.method==='Runtime.exceptionThrown')errors.push('Uncaught browser exception')
    if(message.method==='Page.javascriptDialogOpening')void command('Page.handleJavaScriptDialog',{accept:true})
    if(message.method==='Fetch.requestPaused') {
      const {request,requestId}=message.params
      const isPaid=request.method==='POST' && /\/(generations|edits)$/.test(new URL(request.url).pathname)
      if(isPaid)errors.push('Unexpected paid request blocked')
      void command(isPaid?'Fetch.failRequest':'Fetch.continueRequest',isPaid?{requestId,errorReason:'BlockedByClient'}:{requestId})
    }
  }
  await command('Page.enable');await command('Runtime.enable')
  await command('Fetch.enable',{patterns:[{urlPattern:'*/api/v1/*',requestStage:'Request'}]})
  await command('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads})
  await command('Page.navigate',{url})
  await until("!!document.querySelector('input[type=email]')")
  for(const [type,value] of [['email',account.email],['password',account.password]])await evaluate(`(()=>{const el=document.querySelector('input[type=${type}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await click('로그인')
  await until("!document.querySelector('input[type=email]')")
  await command('Page.navigate',{url:new URL(`/generations/${report.id}`,url).href})
  await until("!!document.querySelector('.generated-image')?.naturalWidth")
  await command('Page.reload')
  await until("!!document.querySelector('.generated-image')?.naturalWidth")
  await click('AI 시안 다운로드')
  const filename=path.join(downloads,`ai-concept-${report.id}.png`)
  let downloaded
  for(let n=0;n<100;n++){try{downloaded=await readFile(filename);break}catch{await sleep(100)}}
  if(!downloaded)throw new Error('Download not found')
  const sha=b=>createHash('sha256').update(b).digest('hex')
  if(sha(downloaded)!==sha(await readFile(path.join(folder,'result.png'))))throw new Error('Downloaded image mismatch')
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  if(await evaluate('document.documentElement.scrollWidth>innerWidth'))throw new Error('Mobile overflow')
  const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})
  await writeFile(path.join(folder,`browser-${browser}.png`),Buffer.from(screenshot.data,'base64'))
  let deleted=false
  if(process.argv.includes('--delete')){
    await click('결과 삭제')
    await until("document.body.innerText.includes('생성 이력')")
    await command('Page.navigate',{url:new URL(`/generations/${report.id}`,url).href})
    await until("!!document.querySelector('[role=alert]')")
    if(await evaluate("!!document.querySelector('.generated-image')"))throw new Error('Deleted image resurrected')
    deleted=true
  }else{
    await click('생성 화면으로')
    await until("document.body.innerText.includes('생성 이력')")
  }
  await click('로그아웃')
  await until("!!document.querySelector('input[type=email]')")
  if(errors.length)throw new Error(errors.join('; '))
  await writeFile(path.join(folder,`browser-${browser}.json`),JSON.stringify({browser,revisit:true,reload:true,download_sha256:sha(downloaded),mobile_overflow:false,deleted,paid_calls:0,logout:true},null,2))
  console.log(`${browser}: live result revisit/reload/download/mobile/logout passed; deleted=${deleted}; paid calls=0`)
}finally{
  if(socket?.readyState===1){await command('Browser.close').catch(()=>{});socket.close()}
  child.kill()
}
