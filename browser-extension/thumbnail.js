export function thumbnailData(value) {
  return typeof value === 'string' && value.length <= 160000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(value) ? value : ''
}

export async function cropThumbnail(screenshot, crop) {
  if (!crop || ![crop.x, crop.y, crop.width, crop.height, crop.viewport?.width, crop.viewport?.height].every(Number.isFinite)
    || crop.width < 40 || crop.height < 40 || crop.x < 0 || crop.y < 0 || crop.viewport.width <= 0 || crop.viewport.height <= 0
    || crop.x + crop.width > crop.viewport.width || crop.y + crop.height > crop.viewport.height) return ''
  const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob())
  try {
    const scale = Math.min(1, 640 / Math.max(crop.width, crop.height))
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(crop.width * scale)), Math.max(1, Math.round(crop.height * scale)))
    const context = canvas.getContext('2d')
    const sx = bitmap.width / crop.viewport.width, sy = bitmap.height / crop.viewport.height
    context.drawImage(bitmap, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, canvas.width, canvas.height)
    const bytes = new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg', quality:.8})).arrayBuffer())
    if (bytes.length > 119000) return ''
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return thumbnailData('data:image/jpeg;base64,' + btoa(binary))
  } finally {bitmap.close()}
}
