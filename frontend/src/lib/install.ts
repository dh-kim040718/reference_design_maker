interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>
}
let available: InstallPrompt | null = null
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  available = event as InstallPrompt
  window.dispatchEvent(new Event('install-availability'))
})
window.addEventListener('appinstalled', () => {available = null; window.dispatchEvent(new Event('install-availability'))})
export function canInstall() {return available !== null}
export async function installApp() {
  const prompt = available
  if (!prompt) return
  available = null
  window.dispatchEvent(new Event('install-availability'))
  await prompt.prompt()
  await prompt.userChoice
}
