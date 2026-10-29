import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { getHealth } from './lib/api'

vi.mock('./lib/api', () => ({
  getHealth: vi.fn(),
}))

const mockedGetHealth = vi.mocked(getHealth)

describe('App', () => {
  afterEach(() => {
    cleanup()
    vi.resetAllMocks()
  })

  it('shows a connected status when the API responds', async () => {
    mockedGetHealth.mockResolvedValue({ status: 'ok' })

    render(<App />)

    expect(await screen.findByRole('status')).toHaveTextContent('API 연결됨')
  })

  it('shows a disconnected status when the API request fails', async () => {
    mockedGetHealth.mockRejectedValue(new Error('API unavailable'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('API 연결 안 됨')
    })
  })
})
