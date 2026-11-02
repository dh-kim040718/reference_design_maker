import {afterEach, expect, it, vi} from 'vitest'
import {canInstall, installApp} from './install'

afterEach(() => {window.dispatchEvent(new Event('appinstalled'))})
it('offers installation only after a real browser installation event', async () => {
  expect(canInstall()).toBe(false)
  const event = new Event('beforeinstallprompt', {cancelable: true})
  const prompt = vi.fn().mockResolvedValue(undefined)
  Object.assign(event, {prompt, userChoice: Promise.resolve({outcome: 'accepted'})})
  window.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect(canInstall()).toBe(true)
  await installApp()
  expect(prompt).toHaveBeenCalledTimes(1)
  expect(canInstall()).toBe(false)
})
