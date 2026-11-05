import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectGenerationPage } from './ProjectGenerationPage'
import { api, ApiError } from './lib/api'

vi.mock('./lib/api', async original => ({...await original<typeof import('./lib/api')>(), api: vi.fn()}))
afterEach(() => {cleanup(); vi.resetAllMocks()})
const image = 'data:image/png;base64,dGVzdA=='
const references = [
  {id: 'layout', title: '레이아웃', type_name: 'Dashboard', design_note: '전체 배치 참고', preview_url: image as string | null, archived_type: false},
  {id: 'chart', title: '차트', type_name: 'Chart', design_note: '그래프 표현 참고', preview_url: image, archived_type: true},
]
const context = {project_id: 'p', project_name: '물류 프로젝트', brief: '물류 관리 대시보드', references, total: 2, context_digest: 'a'.repeat(64), blocked_reason: '', max_references: 16, read_only: false, prompt_characters: 1000}
function setup({enabled = true, input = context} = {}) {
  let current = input
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path === '/projects/p/generation-context') return current
    if (path === '/generation-policy') return {enabled, remaining: 3, daily_limit: 3}
    if (path.includes('/generation-source')) throw new ApiError(422, '저장된 이미지가 없습니다.')
    if (path === '/projects/p/generations') return method === 'POST' ? {id: 'job'} : {items: []}
    if (path === '/projects/p/brief') {current = {...current, brief: (body as {brief: string}).brief}; return {brief: current.brief}}
    throw new Error('Unexpected request')
  })
}
async function prepare() {
  fireEvent.click(await screen.findByRole('checkbox', {name: /사용할 권한/}))
}

it('explains unmet requirements beside the CTA and links to the editable field', async () => {
  setup({input:{...context,brief:''}})
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()}/> )
  const hint = await screen.findByRole('link',{name:'어떤 디자인을 만들지 요구사항을 입력해 주세요.'})
  expect(hint).toHaveAttribute('href','#concept-brief-input')
  await prepare()
  const button = screen.getByRole('button',{name:'프로젝트 시안 1장 만들기'})
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-describedby','concept-blockers')
  fireEvent.change(screen.getByLabelText('어떤 디자인을 만들까요?'),{target:{value:'모바일 화면'}})
  expect(button).toBeEnabled()
  expect(screen.queryByText('생성 전 확인')).not.toBeInTheDocument()
})

it('explains a daily limit even when generation is enabled and rights are confirmed', async () => {
  setup()
  const original = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async(path,method,body)=>path==='/generation-policy'
    ? {enabled:true,remaining:0,daily_limit:3} : original(path,method,body))
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()}/> )
  await prepare()
  expect(screen.getByText(/오늘의 생성 횟수를 모두 사용했습니다/)).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'프로젝트 시안 1장 만들기'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(),'POST',expect.anything())
})

it('supports partial selection, select all, clear all, and submits only checked references', async () => {
  setup({input: {...context, references: [references[0], {...references[1], preview_url: null}]}})
  const navigate = vi.fn()
  render(<ProjectGenerationPage projectId="p" navigate={navigate} />)
  const all = await screen.findByRole('checkbox', {name: '레퍼런스 전체 선택'})
  expect(all).toBeChecked()
  fireEvent.click(screen.getByRole('button', {name: '전체 해제'}))
  expect(all).not.toBeChecked()
  await prepare()
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeDisabled()
  fireEvent.click(all)
  expect(screen.getByRole('checkbox', {name: '차트 참고 이미지 선택'})).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', {name: '차트 참고 이미지 선택'}))
  expect(all).toBePartiallyChecked()
  expect(screen.getByText('1 / 2개 선택')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/generations/job'))
  expect(api).toHaveBeenCalledWith('/projects/p/generations', 'POST', expect.objectContaining({selected_reference_ids: ['layout'], sources: [{reference_id: 'layout', image}]}))
  expect(api).not.toHaveBeenCalledWith('/references/chart/generation-source')
})

it('displays remote saved thumbnails without treating their URLs as generation inputs', async () => {
  const input = {...context, references: references.map(row => ({...row, preview_url: null, thumbnail_url: 'https://i.pinimg.com/cover.jpg'}))}
  setup({input})
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  expect(await screen.findByRole('img', {name: '레이아웃 저장된 미리보기'})).toHaveAttribute('src', 'https://i.pinimg.com/cover.jpg')
  expect(screen.queryByRole('button', {name: '저장된 미리보기 모두 사용'})).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining('generation-source'))
})

it('prepares remote images only on CTA and sends image data instead of URLs', async () => {
  setup({input: {...context, references: references.map(row => ({...row, preview_url: null}))}})
  const original = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async (path, method, body) => path.includes('generation-source') ? {image} : original(path, method, body))
  const navigate = vi.fn()
  render(<ProjectGenerationPage projectId="p" navigate={navigate} />)
  await prepare()
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining('generation-source'))
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/generations/job'))
  expect(api).toHaveBeenCalledWith('/references/layout/generation-source')
  expect(api).toHaveBeenCalledWith('/references/chart/generation-source')
  expect(api).toHaveBeenCalledWith('/projects/p/generations', 'POST', expect.objectContaining({sources: [{reference_id: 'layout', image}, {reference_id: 'chart', image}]}))
})

it('retries a temporary image error without replacing the image or automatically generating', async () => {
  setup({input: {...context, references: [{...references[0], preview_url: null}, references[1]]}})
  const original = vi.mocked(api).getMockImplementation()!
  let attempts = 0
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (path.includes('generation-source')) {
      if (++attempts === 1) throw new ApiError(500, 'Server error')
      return {image}
    }
    return original(path, method, body)
  })
  const navigate = vi.fn()
  render(<ProjectGenerationPage projectId="p" navigate={navigate} />)
  await prepare()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  fireEvent.click(await screen.findByRole('button', {name: '이미지 다시 준비'}))
  await screen.findByText('이미지가 준비됐습니다. 시안 만들기를 누르면 이어서 진행합니다.')
  expect(screen.queryByLabelText('레이아웃 이미지 교체')).not.toBeInTheDocument()
  expect(api).not.toHaveBeenCalledWith('/projects/p/generations', 'POST', expect.anything())
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/generations/job'))
  expect(attempts).toBe(2)
})

it('shows saved previews immediately without selecting or submitting AI inputs', async () => {
  setup()
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  expect(await screen.findByRole('img', {name: '레이아웃 저장된 미리보기'})).toHaveAttribute('src', image)
  expect(screen.getByRole('img', {name: '차트 저장된 미리보기'})).toHaveAttribute('src', image)
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
  await prepare()
  expect(screen.getByRole('img', {name: '레이아웃 저장된 미리보기'})).toHaveAttribute('src', image)
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeEnabled()
})

it('pairs every project image with its note across classifications and submits only explicitly', async () => {
  setup()
  const navigate = vi.fn()
  render(<ProjectGenerationPage projectId="p" navigate={navigate} />)
  expect(await screen.findByText('전체 배치 참고')).toBeInTheDocument()
  expect(screen.getByText('그래프 표현 참고')).toBeInTheDocument()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
  await prepare()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/generations/job'))
  expect(api).toHaveBeenCalledWith('/projects/p/generations', 'POST', expect.objectContaining({
    context_digest: context.context_digest, sources: [{reference_id: 'layout', image}, {reference_id: 'chart', image}], rights_confirmed: true,
  }))
})

it('does not silently generate from only the prepared subset', async () => {
  setup({input: {...context, references: [references[0], {...references[1], preview_url: null}]}})
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  await prepare()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  expect(await screen.findByLabelText('차트 이미지 교체')).toBeInTheDocument()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('keeps a large library selectable and blocks only an oversized generation selection', async () => {
  const rows = Array.from({length: 17}, (_, i) => ({...references[0], id: `ref-${i}`, title: `참고 ${i}`}))
  setup({input: {...context, total: 17, references: rows}})
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  expect(await screen.findByText(/한 번에 최대 16개/)).toBeInTheDocument()
  expect(screen.getAllByRole('checkbox', {name: /참고 이미지 선택/})).toHaveLength(17)
  await prepare()
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', {name: '참고 16 참고 이미지 선택'}))
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeEnabled()
  expect(api).not.toHaveBeenCalledWith(expect.anything(), 'POST', expect.anything())
})

it('submits current requirements directly without a separate save', async () => {
  setup()
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  await prepare()
  fireEvent.change(screen.getByLabelText('어떤 디자인을 만들까요?'), {target: {value: '모바일 물류 화면'}})
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeEnabled()
  expect(screen.queryByRole('button', {name: '요구사항 저장'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  await waitFor(() => expect(api).toHaveBeenCalledWith('/projects/p/generations', 'POST', expect.objectContaining({brief: '모바일 물류 화면'})))
  expect(api).not.toHaveBeenCalledWith('/projects/p/brief', 'PATCH', expect.anything())
})

it('freezes input and reuses the request after an ambiguous connection error', async () => {
  setup()
  const original = vi.mocked(api).getMockImplementation()!
  const attempts: unknown[] = []
  vi.mocked(api).mockImplementation(async (path, method, body) => {
    if (method === 'POST') {attempts.push(body); throw new ApiError(0, '연결 실패')}
    return original(path, method, body)
  })
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  await prepare()
  fireEvent.click(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'}))
  fireEvent.click(await screen.findByRole('button', {name: '같은 프로젝트 요청 상태 확인'}))
  await waitFor(() => expect(attempts).toHaveLength(2))
  expect(attempts[0]).toEqual(attempts[1])
  expect(screen.getByLabelText('어떤 디자인을 만들까요?')).toBeDisabled()
  expect(screen.getByRole('button', {name: '프로젝트 입력 새로고침'})).toBeDisabled()
})

it('keeps paid generation disabled and labels legacy history distinctly', async () => {
  setup({enabled: false})
  const original = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async (path, method, body) => path === '/projects/p/generations'
    ? {items: [{id: 'old', scope: 'reference', status: 'succeeded', instruction: ''}]}
    : original(path, method, body))
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  await prepare()
  expect(screen.getByRole('button', {name: /과거 단일 참고 시안/})).toBeInTheDocument()
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeDisabled()
})

it('shows saved guidance and blocks generation until changed-image regions are reviewed', async () => {
  const guided = {...context, references: [{...references[0], guidance_stale: true, design_guidance: {roles: ['color'], regions: [{x: .1, y: .1, width: .3, height: .2, note: 'Use the chart'}]}}], total: 1}
  setup({input: guided})
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  await prepare()
  expect(screen.getByText('컬러')).toBeInTheDocument()
  expect(screen.getByText('영역 메모 1개')).toBeInTheDocument()
  expect(screen.getByRole('button', {name: '프로젝트 시안 1장 만들기'})).toBeDisabled()
  expect(api).not.toHaveBeenCalledWith('/projects/p/generations', 'POST', expect.anything())
})

it('submits physical output dimensions with the selected designer purpose', async () => {
  setup()
  render(<ProjectGenerationPage projectId="p" navigate={vi.fn()} />)
  fireEvent.click(await screen.findByRole('combobox',{name:'사용 목적'}))
  fireEvent.click(screen.getByRole('option',{name:'포스터'}))
  fireEvent.change(screen.getByLabelText('가로'), {target:{value:'210'}})
  fireEvent.change(screen.getByLabelText('세로'), {target:{value:'297'}})
  await prepare()
  fireEvent.click(screen.getByRole('button',{name:'프로젝트 시안 1장 만들기'}))
  await waitFor(()=>expect(api).toHaveBeenCalledWith('/projects/p/generations','POST',expect.objectContaining({design_settings:{purpose:'poster',purpose_detail:'',width:210,height:297,unit:'mm',ppi:300}})))
})

it('restores the purpose, unit, physical dimensions and resolution for regeneration', async()=>{
  setup()
  const original=vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async(path,method,body)=>path==='/generations/previous'
    ? {id:'previous',scope:'project',project_id:'p',project_snapshot:{design_settings:{purpose:'packaging',purpose_detail:'',width:10,height:15,unit:'cm',ppi:150}}}
    : original(path,method,body))
  render(<ProjectGenerationPage projectId="p" fromJobId="previous" navigate={vi.fn()}/> )
  await waitFor(()=>expect(screen.getByRole('combobox',{name:'사용 목적'})).toHaveTextContent('패키지·라벨'))
  expect(screen.getByLabelText('크기 단위')).toHaveValue('cm')
  expect(screen.getByLabelText('가로')).toHaveValue(10)
  expect(screen.getByLabelText('세로')).toHaveValue(15)
  expect(screen.getByLabelText('해상도 (ppi)')).toHaveValue(150)
})
