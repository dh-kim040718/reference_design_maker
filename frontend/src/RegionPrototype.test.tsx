import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RegionPrototype } from './RegionPrototype'

afterEach(() => {cleanup(); vi.restoreAllMocks()})
it('creates an original-size transparent mask without copying source image pixels', () => {
  const fillRect = vi.fn(), clearRect = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({fillRect, clearRect} as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,mask')
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  render(<RegionPrototype source="data:image/png;base64,test" />)
  fireEvent.click(screen.getByText('영역 편집 준비 · 로컬 실험'))
  const image = screen.getByRole('img')
  Object.defineProperties(image, {naturalWidth: {value: 1000}, naturalHeight: {value: 500}})
  fireEvent.load(image)
  fireEvent.change(screen.getByLabelText('왼쪽'), {target: {value: '10'}})
  fireEvent.change(screen.getByLabelText('위쪽'), {target: {value: '20'}})
  fireEvent.change(screen.getByLabelText('너비'), {target: {value: '30'}})
  fireEvent.change(screen.getByLabelText('높이'), {target: {value: '40'}})
  fireEvent.click(screen.getByRole('button', {name: '마스크 PNG 다운로드'}))
  expect(fillRect).toHaveBeenCalledWith(0, 0, 1000, 500)
  expect(clearRect).toHaveBeenCalledWith(100, 100, 300, 200)
  expect(click).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', {name: '선택 초기화'}))
  expect(screen.getByRole('button', {name: '마스크 PNG 다운로드'})).toBeDisabled()
})
