import { captureUrl, defaultOrigin } from './capture.js'

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
