import { captureUrl, defaultOrigin } from './capture.js'
import { readPagePreview, makePageThumbnail } from './page-preview.js'
import { thumbnailData, cropThumbnail } from './thumbnail.js'

chrome.action.onClicked.addListener(async tab => {
  try {
    await chrome.action.setBadgeText({text: '…'})
    const settings = await chrome.storage.local.get({appOrigin: defaultOrigin})
    let source = tab, preview = ''
    const fallback = captureUrl(settings.appOrigin, tab)
    if (Number.isInteger(tab.id) && new URL(fallback).searchParams.has('url')) {
      try {
        const results = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: readPagePreview})
        const page = results[0]?.result
        if (page && typeof page.url === 'string' && new URL(page.url).origin === new URL(tab.url).origin) {
          source = {...tab, url: page.url, title: page.title || tab.title}
          preview = typeof page.preview === 'string' ? page.preview : ''
          if (preview) {
            try {
              const converted = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: makePageThumbnail, args: [preview]})
              preview = thumbnailData(converted[0]?.result) || preview
            } catch { /* Fall through to a visible-image crop, then the URL. */ }
          }
          if (!thumbnailData(preview) && page.crop && Number.isInteger(tab.windowId)) {
            try {
              const [active] = await chrome.tabs.query({active: true, windowId: tab.windowId})
              if (active?.id === tab.id && active.url === source.url) {
                const latest = await chrome.scripting.executeScript({target:{tabId:tab.id},func:readPagePreview})
                const current = latest[0]?.result
                if (current?.url === source.url && current.preview === page.preview && current.crop) {
                  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'})
                  const [stillActive] = await chrome.tabs.query({active: true, windowId: tab.windowId})
                  if (stillActive?.id === tab.id && stillActive.url === source.url) preview = await cropThumbnail(shot, current.crop) || preview
                }
              }
            } catch { /* Never send an uncropped screenshot or another tab. */ }
          }
        }
      } catch { /* Restricted pages still open the normal confirmation screen. */ }
    }
    await chrome.tabs.create({url: captureUrl(settings.appOrigin, source, preview)})
    await chrome.action.setBadgeText({text: ''})
  } catch {
    await chrome.action.setBadgeText({text: '!'})
    await chrome.runtime.openOptionsPage()
  }
})
