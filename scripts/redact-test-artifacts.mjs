import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Playwright writes request and response headers into error-context.md when a
// test fails. In CI those include the session cookie of the throwaway test
// account. Before the failure evidence is uploaded, the value of every
// credential-bearing header line is replaced; the header name, the status
// lines and the stack around it stay readable. This is header redaction only,
// not a general scrub of personal data.
const HEADER =
  /^(\s*(?:-\s*)?(?:cookie|set-cookie|authorization|proxy-authorization|apikey|x-api-key)\s*:\s*)(.*)$/i
const REDACTED = '[redacted]'

export function redactLine(line) {
  const match = HEADER.exec(line)
  if (!match || match[2] === '' || match[2] === REDACTED) return line
  return match[1] + REDACTED
}

export function redactText(text) {
  return text.split('\n').map(redactLine).join('\n')
}

/** Every error-context.md under root, following no symbolic links. */
export function findContexts(root) {
  const found = []
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) found.push(...findContexts(path))
    else if (entry.isFile() && entry.name === 'error-context.md')
      found.push(path)
  }
  return found
}

/** Rewrites each file in place; returns how many changed. */
export function redactArtifacts(root = 'test-results') {
  let changed = 0
  for (const path of findContexts(root)) {
    if (lstatSync(path).isSymbolicLink()) continue
    const before = readFileSync(path, 'utf8')
    const after = redactText(before)
    if (after !== before) {
      writeFileSync(path, after)
      changed++
    }
  }
  return changed
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = process.argv[2] ?? 'test-results'
  const changed = redactArtifacts(root)
  console.log(
    `Redacted credential headers in ${changed} error-context file(s).`,
  )
}
