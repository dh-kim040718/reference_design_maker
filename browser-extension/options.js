import { appOrigin, defaultOrigin } from './capture.js'
const input = document.querySelector('#origin')
const status = document.querySelector('#status')
const settings = await chrome.storage.local.get({appOrigin: defaultOrigin})
input.value = settings.appOrigin
document.querySelector('#settings').addEventListener('submit', async event => {
  event.preventDefault()
  try {
    const origin = appOrigin(input.value.trim())
    await chrome.storage.local.set({appOrigin: origin})
    input.value = origin
    status.textContent = '저장했습니다. 외부 페이지에서 확장 버튼을 눌러보세요.'
  } catch {status.textContent = '앱의 HTTPS 주소 또는 로컬 개발 주소를 확인해 주세요.'}
})
