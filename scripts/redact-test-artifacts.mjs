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

/**
 * Every error-context.md under root, following no symbolic links, the root
 * included. A missing root is an empty result; any other filesystem error
 * propagates so the caller fails closed instead of uploading unredacted files.
 */
const fs = { lstatSync, readdirSync, readFileSync, writeFileSync }

export function findContexts(root, io = fs) {
  const found = []
  let entries
  try {
    if (io.lstatSync(root).isSymbolicLink()) return found
    entries = io.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return found
    throw error
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) found.push(...findContexts(path, io))
    else if (entry.isFile() && entry.name === 'error-context.md')
      found.push(path)
  }
  return found
}

/**
 * Rewrites each file in place; returns how many changed. Every file is read
 * before any is written, so a read error leaves nothing half-redacted.
 */
export function redactArtifacts(root = 'test-results', io = fs) {
  const pending = []
  for (const path of findContexts(root, io)) {
    if (io.lstatSync(path).isSymbolicLink()) continue
    const before = io.readFileSync(path, 'utf8')
    const after = redactText(before)
    if (after !== before) pending.push([path, after])
  }
  for (const [path, after] of pending) io.writeFileSync(path, after)
  return pending.length
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
