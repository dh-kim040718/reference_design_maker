import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectHeader } from './ProjectHeader'

afterEach(cleanup)

it('opens history within the selected classification without an AI tab', () => {
  const navigate = vi.fn()
  render(<ProjectHeader projectId="p" typeId="mobile" name="Project" active="references" count={2} navigate={navigate} />)
  expect(screen.queryByRole('link', {name: 'AI 시안'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', {name: '시안 이력'}))
  expect(navigate).toHaveBeenCalledWith('/projects/p/generate?type=mobile#history')
})

it('uses project scope when no classification is selected', () => {
  render(<ProjectHeader projectId="p" name="Project" active="generation" count={6} navigate={vi.fn()} />)
  expect(screen.getByRole('link', {name: '레퍼런스로 돌아가기'})).toHaveAttribute('href', '/projects/p')
  expect(screen.getByText('시안 만들기')).toHaveAttribute('aria-current', 'page')
})
