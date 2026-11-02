import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, getSession, saveSession, type Session } from './api'

const session: Session = {access_token: 'old', refresh_token: 'refresh', expires_in: 1,
  user: {id: 'owner'}}
afterEach(() => {saveSession(null); vi.unstubAllGlobals()})
describe('authenticated API requests', () => {
  it('shares login with a new app tab and clears it when another tab logs out', () => {
    saveSession(session)
    expect(JSON.parse(localStorage.getItem('reference-maker-session')!)).toEqual(session)
    expect(sessionStorage.getItem('reference-maker-session')).toBeNull()
    localStorage.removeItem('reference-maker-session')
    window.dispatchEvent(new StorageEvent('storage', {key: 'reference-maker-session'}))
    expect(getSession()).toBeNull()
  })

  it('does not display an old-account response after another tab switches accounts', async () => {
    saveSession(session)
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      localStorage.setItem('reference-maker-session', JSON.stringify({...session, user: {id: 'different-user'}}))
      return Response.json({items: ['private old-account content']})
    }))
    await expect(api('/projects')).rejects.toThrow('다시 로그인')
    expect(getSession()?.user.id).toBe('different-user')
  })
  it('explains a missing endpoint instead of showing an opaque failure', async () => {
    saveSession(session)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({detail: 'Not Found'}, {status: 404})))
    await expect(api('/missing')).rejects.toThrow('요청한 API를 찾을 수 없습니다.')
  })
  it('refreshes an expired access token then retries with the new token', async () => {
    saveSession(session)
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', {status: 401}))
      .mockResolvedValueOnce(Response.json({...session, access_token: 'new'}))
      .mockResolvedValueOnce(Response.json({items: []}))
    vi.stubGlobal('fetch', fetcher)
    expect(await api('/projects')).toEqual({items: []})
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[2][1].headers.Authorization).toBe('Bearer new')
  })

  it('does not automatically repeat a write after an ambiguous network failure', async () => {
    saveSession(session)
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Network failure'))
    vi.stubGlobal('fetch', fetcher)
    await expect(api('/references', 'POST', {})).rejects.toThrow('처리 여부를 확인하지 못했습니다.')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('clears expired credentials when the refresh token is rejected', async () => {
    saveSession(session)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {status: 401})))
    await expect(api('/projects')).rejects.toBeInstanceOf(ApiError)
    expect(getSession()).toBeNull()
  })

  it('handles a successful logout response without parsing JSON', async () => {
    saveSession(session)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {status: 204})))
    expect(await api('/auth/logout', 'POST')).toBeUndefined()
  })
})
