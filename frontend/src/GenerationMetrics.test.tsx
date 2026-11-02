import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GenerationMetrics } from './GenerationMetrics'
import { api } from './lib/api'

vi.mock('./lib/api', async original => ({...await original<typeof import('./lib/api')>(), api: vi.fn()}))
afterEach(() => {cleanup(); vi.resetAllMocks()})
const summary = {total: 3, statuses: {succeeded: 1, failed: 1, unknown: 1, queued: 0, processing: 0}, operations: {generate: 2, edit: 1}, latency: {average_ms: null}, usage: {known_jobs: 0, total_tokens: 0, missing_jobs: 3}}

it('fetches only on demand and explains missing usage without claiming zero cost', async () => {
  vi.mocked(api).mockResolvedValue(summary)
  render(<GenerationMetrics />)
  expect(api).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', {name: '내 AI 사용 현황 보기'}))
  expect(await screen.findByText(/전체 3건/)).toBeInTheDocument()
  expect(screen.getByText(/제공된 사용량 없음/)).toBeInTheDocument()
  expect(screen.getByText(/실제 청구액은 제공자 사용 내역/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('조회 기간'), {target: {value: '30'}})
  await waitFor(() => expect(api).toHaveBeenCalledWith('/generation-metrics?days=30'))
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('supports retry after a failed metrics read without sending a generation request', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(summary)
  render(<GenerationMetrics />)
  fireEvent.click(screen.getByRole('button', {name: '내 AI 사용 현황 보기'}))
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name: '사용 현황 새로고침'}))
  expect(await screen.findByText(/전체 3건/)).toBeInTheDocument()
  expect(api).toHaveBeenCalledTimes(2)
})
