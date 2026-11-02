import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { EditRequestForm } from './EditRequestForm'
import { api, ApiError } from './lib/api'

vi.mock('./lib/api', async original => ({...await original<typeof import('./lib/api')>(), api: vi.fn()}))
afterEach(() => {cleanup(); vi.resetAllMocks()})
const props = {source: 'data:image/png;base64,source', mask: 'data:image/png;base64,mask', referenceId: 'ref', direction: '기존 방향'}

it('keeps offline preparation editable while blocking submission before editing activation', async () => {
  vi.mocked(api).mockResolvedValue({editing_enabled: false, remaining: 3})
  render(<EditRequestForm {...props} navigate={vi.fn()} />)
  expect(await screen.findByText(/영역 편집 연동·품질 검증 대기/)).toBeInTheDocument()
  expect(screen.getByLabelText('유지할 디자인 방향')).toHaveValue('기존 방향')
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('button', {name: '선택 영역 1회 편집'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('sends source, mask and separate direction/instruction only on explicit submission', async () => {
  vi.mocked(api).mockImplementation(async (_path, method) => method === 'POST' ? {id: 'edit'} : {editing_enabled: true, remaining: 3})
  const navigate = vi.fn()
  render(<EditRequestForm {...props} navigate={navigate} />)
  fireEvent.change(screen.getByLabelText('선택 영역 편집 지시 (선택)'), {target: {value: '여백 확대'}})
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(screen.getByRole('button', {name: '선택 영역 1회 편집'})).toBeEnabled())
  fireEvent.click(screen.getByRole('button', {name: '선택 영역 1회 편집'}))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/generations/edit'))
  expect(api).toHaveBeenCalledWith('/references/ref/edits', 'POST', expect.objectContaining({
    source_image: props.source, mask_image: props.mask, direction: '기존 방향', instruction: '여백 확대', rights_confirmed: true,
  }))
})

it('reuses the same request after a connection failure and freezes the submitted inputs', async () => {
  const calls: unknown[] = []
  vi.mocked(api).mockImplementation(async (_path, method, body) => {
    if (method === 'POST') {calls.push(body); throw new ApiError(0, '연결 실패')}
    return {editing_enabled: true, remaining: 3}
  })
  render(<EditRequestForm {...props} navigate={vi.fn()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  await waitFor(() => expect(screen.getByRole('button', {name: '선택 영역 1회 편집'})).toBeEnabled())
  fireEvent.click(screen.getByRole('button', {name: '선택 영역 1회 편집'}))
  fireEvent.click(await screen.findByRole('button', {name: '같은 편집 요청 상태 확인'}))
  await waitFor(() => expect(calls).toHaveLength(2))
  expect(calls[0]).toEqual(calls[1])
  expect(screen.getByLabelText('유지할 디자인 방향')).toBeDisabled()
})
