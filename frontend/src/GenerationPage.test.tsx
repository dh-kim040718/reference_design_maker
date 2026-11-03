import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GenerationPage } from './GenerationPage'
import { api, ApiError } from './lib/api'

vi.mock('./lib/api', async original => ({...await original<typeof import('./lib/api')>(), api: vi.fn()}))
afterEach(() => {cleanup(); vi.resetAllMocks()})
const source = 'data:image/png;base64,dGVzdA=='
function setup(enabled: boolean) {
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/references/ref') return {id: 'ref', title: 'Dashboard', design_note: null, preview_url: source}
    if (path === '/generation-policy') return {enabled, remaining: 3, daily_limit: 3}
    if (path === '/references/ref/generations') return {items: []}
    throw new Error('Unexpected request')
  })
}
it('shows the approval gate without sending a generation request', async () => {
  setup(false)
  render(<GenerationPage referenceId="ref" navigate={vi.fn()} />)
  expect(await screen.findByText('유료 API 사용 승인 대기')).toBeInTheDocument()
  expect(screen.getByRole('button', {name: 'AI 시안 1장 생성'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('explains an exhausted monetary budget without enabling another request', async () => {
  setup(false)
  const original = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async (path, method, body) => path === '/generation-policy'
    ? {enabled: false, remaining: 3, daily_limit: 3, reason: 'budget_exhausted'}
    : original(path, method, body))
  render(<GenerationPage referenceId="ref" navigate={vi.fn()} />)
  expect(await screen.findByText('AI 사용 예산 한도 도달')).toBeInTheDocument()
  expect(screen.getByRole('button', {name: 'AI 시안 1장 생성'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})
it('keeps the same request id after an ambiguous network failure', async () => {
  setup(true)
  const original = vi.mocked(api).getMockImplementation()!
  const calls: Record<string, unknown>[] = []
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (method === 'POST') {calls.push(body as Record<string, unknown>); throw new ApiError(0, '연결 실패')}
    return original(path, method, body)
  })
  render(<GenerationPage referenceId="ref" navigate={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', {name: '저장된 미리보기 사용'}))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', {name: 'AI 시안 1장 생성'}))
  fireEvent.click(await screen.findByRole('button', {name: '같은 요청 상태 확인'}))
  await waitFor(() => expect(calls).toHaveLength(2))
  expect(calls[0].request_id).toBe(calls[1].request_id)
  expect(calls[0].source_image).toBe(source)
})
it('marks generated results as AI and offers an explicit download and delete', async () => {
  vi.mocked(api).mockResolvedValue({id: 'job', reference_id: 'ref', status: 'succeeded', result_image: source, note_snapshot: ''})
  render(<GenerationPage jobId="job" navigate={vi.fn()} />)
  expect(await screen.findByRole('img', {name: 'AI가 생성한 탐색 시안'})).toBeInTheDocument()
  expect(screen.getByRole('link', {name: 'AI 시안 다운로드'})).toHaveAttribute('download', 'ai-concept-job.png')
  expect(screen.getByRole('button', {name: '결과 삭제'})).toBeInTheDocument()
  expect(screen.getByText('AI 탐색 시안')).toBeInTheDocument()
})

it('opens regeneration preparation without sending another paid request', async () => {
  vi.mocked(api).mockResolvedValue({id: 'job', reference_id: 'ref', status: 'succeeded', result_image: source, note_snapshot: ''})
  const navigate = vi.fn()
  render(<GenerationPage jobId="job" navigate={navigate} />)
  fireEvent.click(await screen.findByRole('button', {name: '전체 재생성 준비'}))
  expect(navigate).toHaveBeenCalledWith('/references/ref/generate?from=job')
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('shows immutable project inputs and regenerates at project scope without a reference id', async () => {
  vi.mocked(api).mockResolvedValue({id: 'project-job', reference_id: null, project_id: 'p', scope: 'project', status: 'succeeded', result_image: source, note_snapshot: '프로젝트 목표', project_snapshot: {project_name: '물류', brief: '프로젝트 목표', references: [{id: 'a', title: '레이아웃', type_name: '화면', design_note: '기존 레이아웃 메모'}, {id: 'b', title: '그래프', type_name: '차트', design_note: '기존 차트 메모'}]}})
  const navigate = vi.fn()
  render(<GenerationPage jobId="project-job" navigate={navigate} />)
  expect(await screen.findByText('검토한 레퍼런스 2개')).toBeInTheDocument()
  expect(screen.getByText('기존 레이아웃 메모')).toBeInTheDocument()
  expect(screen.getByText('기존 차트 메모')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name: '전체 재생성 준비'}))
  expect(navigate).toHaveBeenCalledWith('/projects/p/generate?from=project-job')
})

it('labels historical single-reference results and points new work to the project', async () => {
  vi.mocked(api).mockResolvedValue({id: 'old', reference_id: 'ref', project_id: 'p', scope: 'reference', status: 'succeeded', note_snapshot: ''})
  const navigate = vi.fn()
  render(<GenerationPage jobId="old" navigate={navigate} />)
  expect(await screen.findByText('과거 단일 참고 시안')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 전체 시안 만들기'}))
  expect(navigate).toHaveBeenCalledWith('/projects/p/generate')
})

it('shows a safe billing hint while preserving the no-retry warning for uncertain jobs', async () => {
  vi.mocked(api).mockResolvedValue({id: 'job', reference_id: 'ref', status: 'unknown', provider_reason: 'quota', note_snapshot: ''})
  render(<GenerationPage jobId="job" navigate={vi.fn()} />)
  expect(await screen.findByText('AI 제공자의 결제 잔액 또는 사용 한도를 확인해야 합니다.')).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('자동 재시도하지 않습니다.')
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('prefills the previous instruction but requires a fresh image and explicit submission', async () => {
  setup(false)
  const original = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async (path, method, body) => path === '/generations/job'
    ? {id: 'job', reference_id: 'ref', status: 'succeeded', instruction: '더 넓은 여백', note_snapshot: '이전 메모'}
    : original(path, method, body))
  render(<GenerationPage referenceId="ref" fromJobId="job" navigate={vi.fn()} />)
  expect(await screen.findByText('새 요청으로 전체 재생성')).toBeInTheDocument()
  expect(screen.getByRole('textbox')).toHaveValue('더 넓은 여백')
  expect(screen.getByRole('button', {name: 'AI 시안 1장 생성'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})
