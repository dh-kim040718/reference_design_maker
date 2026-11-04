import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReferenceGuidance } from './ReferenceGuidance'
import { api, type Reference } from './lib/api'

vi.mock('./lib/api', async original => ({...await original<typeof import('./lib/api')>(), api: vi.fn()}))
afterEach(() => {cleanup(); vi.resetAllMocks()})
const reference = {id: 'ref', preview_url: 'https://example.com/image.png', preview_version: 'a'.repeat(64), design_note: 'Existing note', design_guidance: {roles: [], regions: [], image_version: null}} as unknown as Reference
function setup(input = reference) {
  const onSaved = vi.fn()
  render(<ReferenceGuidance reference={input} onSaved={onSaved} onDirtyChange={vi.fn()} />)
  return onSaved
}

it('saves roles without replacing the existing design note or generating an image', async () => {
  vi.mocked(api).mockResolvedValue({})
  const saved = setup()
  fireEvent.click(screen.getByRole('button', {name: '참고 요소 지정'}))
  fireEvent.click(screen.getByRole('checkbox', {name: '컬러'}))
  fireEvent.click(screen.getByRole('button', {name: '참고 요소 저장'}))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(api).toHaveBeenCalledExactlyOnceWith('/references/ref', 'PATCH', {design_guidance: {roles: ['color'], regions: [], image_version: null}})
})

it('adds a keyboard-accessible region and requires a note before saving', async () => {
  vi.mocked(api).mockResolvedValue({})
  setup()
  fireEvent.click(screen.getByRole('button', {name: '참고 요소 지정'}))
  fireEvent.load(screen.getByRole('img'))
  fireEvent.click(screen.getByRole('button', {name: /영역 추가/}))
  expect(screen.getByRole('button', {name: '참고 요소 저장'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('참고할 디자인 포인트'), {target: {value: 'Use the chart'}})
  fireEvent.change(screen.getByLabelText('영역 1 x'), {target: {value: '20'}})
  fireEvent.click(screen.getByRole('button', {name: '참고 요소 저장'}))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/references/ref', 'PATCH', {design_guidance: {roles: [], regions: [{x: .2, y: .1, width: .4, height: .3, note: 'Use the chart'}], image_version: 'a'.repeat(64)}}))
})

it('requires explicit region review after the preview changes', () => {
  setup({...reference, guidance_stale: true, design_guidance: {roles: ['layout'], image_version: 'b'.repeat(64), regions: [{x: .1, y: .1, width: .4, height: .3, note: 'Header'}]}})
  fireEvent.click(screen.getByRole('button', {name: '참고 요소 지정'}))
  expect(screen.getByRole('button', {name: '참고 요소 저장'})).toBeDisabled()
  fireEvent.load(screen.getByRole('img'))
  fireEvent.click(screen.getByRole('button', {name: '새 이미지에서 영역 확인 완료'}))
  expect(screen.getByRole('button', {name: '참고 요소 저장'})).toBeEnabled()
})

it('does not offer editing on archived references', () => {
  setup({...reference, read_only: true})
  expect(screen.queryByRole('button', {name: '참고 요소 지정'})).not.toBeInTheDocument()
})
