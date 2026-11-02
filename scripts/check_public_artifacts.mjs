// Offline check: never reads .env and never prints matched secret values.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const patterns = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/,
  /\bsb_secret_[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL)\s*[:=]\s*["'`][^"'`\r\n]{8,}/,
]
let checked = 0
const failures = []
async function scan(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {if (entry.name !== 'node_modules' && entry.name !== '.git') await scan(full); continue}
    if (!/\.(?:html|js|mjs|css|json|map|txt|webmanifest)$/i.test(entry.name)) continue
    checked++
    const body = await readFile(full, 'utf8')
    if (patterns.some(pattern => pattern.test(body))) failures.push(path.relative(root, full))
  }
}
try {
  await scan(path.join(root, 'frontend/dist'))
  await scan(path.join(root, 'browser-extension'))
  if (failures.length) {
    console.error('Potential secrets found in public files (values suppressed):\n' + failures.join('\n'))
    process.exitCode = 1
  } else console.log(`Public artifact secret scan passed (${checked} text files). No API calls.`)
} catch {
  console.error('Artifact scan could not complete. Build frontend/dist first and check file access.')
  process.exitCode = 1
}
