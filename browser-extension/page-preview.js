// Self-contained: Chrome serializes this function into the clicked tab's isolated world.
export function readPagePreview() {
  const safe = value => {
    if (typeof value !== 'string' || !value.trim()) return ''
    try {
      const url = new URL(value, location.href)
      return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 4096 ? url.href : ''
    } catch {return ''}
  }
  const metadata = selector => safe(document.querySelector(selector)?.content || '')
  const all = selector => [...(document.querySelectorAll?.(selector) || [])]
  let image = ''
  let element = null
  const pinId = location.pathname.match(/^\/pin\/(\d+)\/?$/)?.[1]
  if (/(^|\.)pinterest\.[a-z.]+$/i.test(location.hostname) && pinId) {
    // Do not pick related pins in the feed below the opened pin.
    element = document.querySelector('[data-test-id="pin-closeup-image"] img, img[data-test-id="pin-closeup-image"]')
      || all('[data-test-id="pin-closeup-body"] img')
        .filter(item => item.naturalWidth >= 200 && item.naturalHeight >= 100)
        .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0]
    image = safe(element?.currentSrc || element?.src || '')
    if (!image) {
      // Pinterest changes DOM labels. Its page state identifies the exact pin,
      // so only read image fields attached to that id, never an arbitrary related pin.
      let bytes = 0
      for (const script of all('script[type="application/json"], script[type="application/ld+json"]')) {
        const text = script.textContent || ''
        bytes += text.length
        if (!text || text.length > 2_000_000 || bytes > 4_000_000) continue
        try {
          const queue = [JSON.parse(text)]
          for (let index = 0; index < queue.length && index < 4000 && !image; index++) {
            const node = queue[index]
            if (!node || typeof node !== 'object') continue
            const record = node[pinId] || (String(node.id) === pinId ? node : null)
            if (record && typeof record === 'object') {
              const pictures = record.images || {}
              const candidates = [pictures.orig, pictures['1200x'], pictures['736x'], ...Object.values(pictures), record.image]
              for (const candidate of candidates) {
                image = safe(typeof candidate === 'string' ? candidate : candidate?.url || candidate?.contentUrl || '')
                if (image) break
              }
            }
            if (queue.length < 10000) queue.push(...Object.values(node).filter(value => value && typeof value === 'object').slice(0, 500))
          }
        } catch { /* Unrelated or non-JSON page state. */ }
        if (image) break
      }
    }
    if (!image) {
      element = all('main img, [role="main"] img, [role="dialog"] img')
        .filter(item => {
          const link = item.closest?.('a[href*="/pin/"]')
          return item.naturalWidth >= 200 && item.naturalHeight >= 150 && (!link || new URL(link.href, location.href).pathname === `/pin/${pinId}/`)
            && !item.closest?.('[data-test-id="related-pin"], [data-test-id="pin"]')
        })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]
      image = safe(element?.currentSrc || element?.src || '')
    }
  }
  image ||= metadata('meta[property="og:image:secure_url"]')
  image ||= metadata('meta[property="og:image"]')
  image ||= metadata('meta[name="twitter:image"]')
  image ||= metadata('meta[property="twitter:image"]')
  image ||= safe(document.querySelector('link[rel="image_src"]')?.href || '')
  if (!element && image) element = all('img').find(item => safe(item.currentSrc || item.src || '').split('/').at(-1) === image.split('/').at(-1))
  const rect = element?.getBoundingClientRect?.()
  const viewport = {width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0}
  const crop = rect && rect.width >= 40 && rect.height >= 40 && rect.left >= 0 && rect.top >= 0
    && rect.right <= viewport.width && rect.bottom <= viewport.height
    ? {x: rect.left, y: rect.top, width: rect.width, height: rect.height, viewport} : null
  return {url: location.href, title: document.title.slice(0, 200), preview: image, crop}
}

// Serialize into the same clicked tab. Drawing a CORS-enabled image avoids later
// hotlink/referrer problems; the result is only a small card thumbnail.
export async function makePageThumbnail(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return ''
  return new Promise(resolve => {
    const image = new Image()
    const timer = setTimeout(() => {image.src = ''; resolve('')}, 3500)
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      clearTimeout(timer)
      try {
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d')
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const data = canvas.toDataURL('image/jpeg', .8)
        resolve(data.length <= 160000 ? data : '')
      } catch {resolve('')}
    }
    image.onerror = () => {clearTimeout(timer); resolve('')}
    image.src = url
  })
}
