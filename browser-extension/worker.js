import { captureUrl, defaultOrigin } from './capture.js'

if (typeof OffscreenCanvas !== 'undefined') {
  const canvas = new OffscreenCanvas(32, 32)
  const drawing = canvas.getContext('2d')
  drawing.fillStyle = '#365c43'
  drawing.fillRect(0, 0, 32, 32)
  drawing.fillStyle = '#ffffff'
  drawing.font = 'bold 23px Georgia'
  drawing.textAlign = 'center'
  drawing.fillText('R', 16, 24)
  chrome.action.setIcon({imageData: drawing.getImageData(0, 0, 32, 32)})
}

chrome.action.onClicked.addListener(async tab => {
  try {
    const settings = await chrome.storage.local.get({appOrigin: defaultOrigin})
    await chrome.tabs.create({url: captureUrl(settings.appOrigin, tab)})
    await chrome.action.setBadgeText({text: ''})
  } catch {
    await chrome.action.setBadgeText({text: '!'})
    await chrome.runtime.openOptionsPage()
  }
})
