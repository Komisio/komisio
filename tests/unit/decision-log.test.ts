import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The decision log holds one line per decision; the reasoning goes in the pull
 * request body. Writing the reasoning here instead is how the repository grew
 * 97 documents in a week, so the rule is checked rather than hoped for.
 *
 * Only entries after the marker are checked. Everything above it was written
 * before the rule and is left as it stands: a record is not rewritten to match
 * a later convention.
 */
const MARKER = '<!-- one-line rule from 2026-09-17'
const LIMIT = 300

const log = readFileSync(
  new URL('../../DECISIONS.md', import.meta.url),
  'utf8',
).split('\n')

function entriesUnderTheRule() {
  const start = log.findIndex((line) => line.startsWith(MARKER))
  expect(start, 'the marker is missing from DECISIONS.md').toBeGreaterThan(-1)
  return log
    .slice(start + 1)
    .map((line, index) => ({ line, number: start + index + 2 }))
    .filter(({ line }) => line.trim() !== '')
}

describe('decision log', () => {
  it('keeps every new entry to one line of at most 300 characters', () => {
    const tooLong = entriesUnderTheRule()
      .filter(({ line }) => line.length > LIMIT)
      .map(
        ({ line, number }) =>
          `line ${number} is ${line.length} characters: ${line.slice(0, 70)}…`,
      )
    // A decision that does not fit is not too complicated to record. It is a
    // decision whose reasoning belongs in the pull request that makes it.
    expect(tooLong, tooLong.join('\n')).toEqual([])
  })

  it('keeps every new entry in the dated one-line shape', () => {
    const malformed = entriesUnderTheRule()
      .filter(({ line }) => !/^- \d{4}-\d{2}-\d{2}: \S/.test(line))
      .map(({ line, number }) => `line ${number}: ${line.slice(0, 70)}…`)
    expect(malformed, malformed.join('\n')).toEqual([])
  })

  it('reads a log that has entries above the marker and a marker at the end', () => {
    const start = log.findIndex((line) => line.startsWith(MARKER))
    expect(start).toBeGreaterThan(10)
    expect(log.slice(0, start).join('\n')).toContain('2026-09-16')
  })
})
