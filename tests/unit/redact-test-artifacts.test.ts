import { spawnSync } from 'node:child_process'
import {
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  redactLine,
  redactText,
  redactArtifacts,
} from '../../scripts/redact-test-artifacts.mjs'

// Synthetic values only; nothing here is a real token.
const context = [
  '# Test info',
  '',
  '- Name: platform.spec.ts >> archived inspection drafts',
  '',
  '# Error details',
  '',
  '```',
  'Error: apiRequestContext.post: read ECONNRESET',
  'Call log:',
  '  - → POST http://127.0.0.1:3000/api/intake',
  '    - user-agent: Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/153.0',
  '    - accept: */*',
  '    - Origin: http://127.0.0.1:3000',
  '    - content-type: application/json',
  '    - content-length: 296',
  '    - cookie: sb-127-auth-token=synthetic.jwt.value; other=1',
  '    - Authorization: Bearer synthetic-bearer-value',
  '    - proxy-authorization: Basic c3ludGhldGlj',
  '    - apikey: synthetic-anon-key',
  '    - X-API-Key: synthetic-x-api-key',
  '  - ← 200 OK',
  '    - Set-Cookie: session=synthetic-session; Path=/; HttpOnly',
  '    - x-request-id: 1f7b173b-ec20-4bae-b6f1-aa3b20a7e92a',
  '```',
  '',
  '# Test source',
  '',
  '```ts',
  "  1115 |     page.request.post('/api/intake', {",
  "  1116 |       headers: { Origin: 'http://127.0.0.1:3000' },",
  '    at post (/home/runner/work/komisio/komisio/tests/e2e/platform.spec.ts:1115:18)',
  "    const cookie = request.headers.get('cookie')",
  'https://example.test/rest/v1/items?select=id',
  '```',
].join('\n')

describe('redactLine', () => {
  it.each([
    ['    - cookie: sb-auth=abc; b=2', '    - cookie: [redacted]'],
    ['- Cookie: abc', '- Cookie: [redacted]'],
    ['SET-COOKIE: a=b; Path=/', 'SET-COOKIE: [redacted]'],
    ['  authorization: Bearer x.y.z', '  authorization: [redacted]'],
    ['Proxy-Authorization: Basic zzz', 'Proxy-Authorization: [redacted]'],
    ['\t- apikey: k', '\t- apikey: [redacted]'],
    ['- x-api-key:   spaced', '- x-api-key:   [redacted]'],
  ])('redacts %j keeping the header name', (line, expected) =>
    expect(redactLine(line)).toBe(expected),
  )
  it.each([
    "    const cookie = request.headers.get('cookie')",
    'https://example.test/rest/v1/items?select=id',
    '    - content-type: application/json',
    '    - x-request-id: 1f7b173b-ec20-4bae-b6f1-aa3b20a7e92a',
    '  - ← 200 OK',
    "  1115 |     page.request.post('/api/intake', {",
    'cookies: 3',
    'authorized: true',
    '- cookie:',
  ])('leaves %j unchanged', (line) => expect(redactLine(line)).toBe(line))
})

describe('redactText', () => {
  it('redacts every credential header, keeps status and stack lines, and is idempotent', () => {
    const once = redactText(context)
    for (const secret of [
      'synthetic.jwt.value',
      'synthetic-bearer-value',
      'c3ludGhldGlj',
      'synthetic-anon-key',
      'synthetic-x-api-key',
      'synthetic-session',
    ])
      expect(once).not.toContain(secret)
    expect(once).toContain('    - cookie: [redacted]')
    expect(once).toContain('    - Authorization: [redacted]')
    expect(once).toContain('    - Set-Cookie: [redacted]')
    expect(once).toContain('Error: apiRequestContext.post: read ECONNRESET')
    expect(once).toContain('  - → POST http://127.0.0.1:3000/api/intake')
    expect(once).toContain('  - ← 200 OK')
    expect(once).toContain(
      '    - x-request-id: 1f7b173b-ec20-4bae-b6f1-aa3b20a7e92a',
    )
    expect(once).toContain(
      '    at post (/home/runner/work/komisio/komisio/tests/e2e/platform.spec.ts:1115:18)',
    )
    expect(once).toContain("    const cookie = request.headers.get('cookie')")
    expect(once).toContain('https://example.test/rest/v1/items?select=id')
    expect(once.split('\n')).toHaveLength(context.split('\n').length)
    expect(redactText(once)).toBe(once)
  })
})

describe('redactArtifacts', () => {
  it('rewrites only error-context.md files under the root and reports the count', () => {
    const root = mkdtempSync(join(tmpdir(), 'komisio-redact-'))
    const a = join(root, 'platform-archived', 'error-context.md')
    const b = join(root, 'nested', 'deeper', 'error-context.md')
    const clean = join(root, 'clean', 'error-context.md')
    const other = join(root, 'platform-archived', 'notes.md')
    for (const dir of [a, b, clean, other])
      mkdirSync(join(dir, '..'), { recursive: true })
    writeFileSync(a, context)
    writeFileSync(b, '- cookie: synthetic-b\n')
    writeFileSync(clean, '# Nothing sensitive\n- accept: */*\n')
    writeFileSync(other, '- cookie: synthetic-other\n')
    expect(redactArtifacts(root)).toBe(2)
    expect(readFileSync(a, 'utf8')).not.toContain('synthetic.jwt.value')
    expect(readFileSync(b, 'utf8')).toBe('- cookie: [redacted]\n')
    expect(readFileSync(clean, 'utf8')).toBe(
      '# Nothing sensitive\n- accept: */*\n',
    )
    expect(readFileSync(other, 'utf8')).toBe('- cookie: synthetic-other\n')
    expect(redactArtifacts(root)).toBe(0)
  })
  it('is a no-op when the root does not exist', () => {
    expect(
      redactArtifacts(join(tmpdir(), 'komisio-missing-' + Date.now())),
    ).toBe(0)
  })
  it('fails closed when the root is not a directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'komisio-redact-file-'))
    const file = join(root, 'not-a-directory')
    writeFileSync(file, 'plain file\n')
    expect(() => redactArtifacts(file)).toThrow(/ENOTDIR|ENOENT/)
  })
  it('fails closed on a filesystem error other than a missing root and writes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'komisio-redact-unreadable-'))
    const first = join(root, 'a', 'error-context.md')
    const second = join(root, 'b', 'error-context.md')
    for (const f of [first, second])
      mkdirSync(join(f, '..'), { recursive: true })
    writeFileSync(first, '- cookie: synthetic-first\n')
    writeFileSync(second, '- cookie: synthetic-second\n')
    const denied = Object.assign(new Error('EACCES: permission denied'), {
      code: 'EACCES',
    })
    // Injected filesystem: the second directory cannot be listed. The first
    // file must not be rewritten either, so the upload gate sees a failure
    // and the original context never leaves the runner.
    const io = {
      lstatSync,
      readdirSync: (path: string, options: { withFileTypes: true }) => {
        if (path === join(root, 'b')) throw denied
        return readdirSync(path, options)
      },
      readFileSync,
      writeFileSync,
    }
    expect(() => redactArtifacts(root, io as never)).toThrow(/EACCES/)
    expect(readFileSync(first, 'utf8')).toBe('- cookie: synthetic-first\n')
    expect(readFileSync(second, 'utf8')).toBe('- cookie: synthetic-second\n')
  })
  it('does not traverse a symbolic link at the root or below it', () => {
    const outside = mkdtempSync(join(tmpdir(), 'komisio-redact-outside-'))
    const target = join(outside, 'spec', 'error-context.md')
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, '- cookie: synthetic-outside\n')
    const root = mkdtempSync(join(tmpdir(), 'komisio-redact-links-'))
    let linked = false
    try {
      symlinkSync(outside, join(root, 'link-to-outside'), 'junction')
      linked = true
    } catch {
      // Without link privileges the platform cannot exercise this boundary.
    }
    if (linked) {
      const rootLink = join(tmpdir(), 'komisio-redact-rootlink-' + Date.now())
      symlinkSync(outside, rootLink, 'junction')
      expect(redactArtifacts(rootLink)).toBe(0)
      expect(redactArtifacts(root)).toBe(0)
      expect(readFileSync(target, 'utf8')).toBe('- cookie: synthetic-outside\n')
      rmSync(rootLink, { recursive: false, force: true })
    } else {
      expect(redactArtifacts(root)).toBe(0)
    }
  })
  it('runs as a command against a given root without printing values', () => {
    const root = mkdtempSync(join(tmpdir(), 'komisio-redact-cli-'))
    const file = join(root, 'spec', 'error-context.md')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, '    - cookie: synthetic-cli-value\n')
    const result = spawnSync(
      process.execPath,
      ['scripts/redact-test-artifacts.mjs', root],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('1 error-context file(s)')
    expect(result.stdout + result.stderr).not.toContain('synthetic-cli-value')
    expect(readFileSync(file, 'utf8')).toBe('    - cookie: [redacted]\n')
  })
})
