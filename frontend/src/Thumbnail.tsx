import { useEffect, useEffectEvent, useRef, useState } from 'react'

export function Thumbnail({url, label, className = ''}: {url?: string | null; label: string; className?: string}) {
  const [failed, setFailed] = useState('')
  return <div className={`thumbnail ${className}`}>
    {url && failed !== url ? <img src={url} alt={label} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(url)} />
      : <div className="thumbnail-empty"><span aria-hidden="true">▧</span><span>미리보기 이미지 없음</span></div>}
  </div>
}

async function readThumbnail(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error('10MB 이하의 PNG, JPEG, WebP 이미지를 선택해 주세요.')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const ratio = Math.min(1, 720 / image.width, 540 / image.height)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * ratio))
    canvas.height = Math.max(1, Math.round(image.height * ratio))
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const result = canvas.toDataURL('image/webp', 0.8)
    if (result.length > 400000) throw new Error('더 작은 이미지로 다시 선택해 주세요.')
    return result
  } finally {URL.revokeObjectURL(url)}
}

export function ImagePicker({onChange, disabled = false, label = '이미지 선택', showHint = true, pasteEnabled = true}: {
  onChange: (url: string) => void | Promise<void>; disabled?: boolean; label?: string; showHint?: boolean; pasteEnabled?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const acceptFile = useEffectEvent(async (file: File) => {
    setBusy(true); setError('')
    try {await onChange(await readThumbnail(file))}
    catch (error) {setError(error instanceof Error ? error.message : '이미지를 읽지 못했습니다.')}
    finally {setBusy(false)}
  })
  useEffect(() => {
    if (disabled || busy || !pasteEnabled) return
    const paste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith('image/'))
      if (file) {event.preventDefault(); void acceptFile(file)}
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [disabled, busy, pasteEnabled])
  return <div className="image-picker"><input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="썸네일 이미지 파일" hidden onChange={async event => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); setError('')
    try {await onChange(await readThumbnail(file))} catch (error) {setError(error instanceof Error ? error.message : '이미지를 읽지 못했습니다.')}
    finally {setBusy(false); if (input.current) input.current.value = ''}
  }} /><button type="button" className="secondary" disabled={disabled || busy} onClick={() => input.current?.click()}>{busy ? '이미지 처리 중…' : label}</button>
    {showHint && <p className="hint">이미지를 복사한 뒤 Ctrl+V로 넣을 수도 있어요.</p>}
    {error && <p className="error" role="alert">{error}</p>}</div>
}
