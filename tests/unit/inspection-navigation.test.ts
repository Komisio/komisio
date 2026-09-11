import { describe, expect, it } from 'vitest'
import {
  inspectionNavigation,
  inspectionHref,
} from '../../lib/intake/inspection-navigation'
const draft = '10000000-0000-4000-8000-000000000001'
describe('inspection read navigation', () => {
  it('requires a draft for historical reads and bounds revisions', () => {
    expect(inspectionNavigation.parse({ draft, version: '2' }).version).toBe(2)
    for (const input of [
      { version: '1' },
      { draft, version: '0' },
      { draft, version: '2147483648' },
      { draft, version: ['1', '2'] },
      { draft, version: '1e2' },
      { historyBefore: '2' },
    ])
      expect(inspectionNavigation.safeParse(input).success).toBe(false)
  })
  it('accepts one bounded UUID cursor, never a query expression', () => {
    expect(inspectionNavigation.safeParse({ after: draft }).success).toBe(true)
    expect(
      inspectionNavigation.safeParse({ after: draft, before: draft }).success,
    ).toBe(false)
    expect(inspectionNavigation.safeParse({ after: 'id.gt.0' }).success).toBe(
      false,
    )
  })
  it('encodes navigation values rather than interpolating query text', () => {
    expect(inspectionHref({ draft, version: 2, after: undefined })).toBe(
      `?draft=${draft}&version=2`,
    )
  })
})

it('defaults to active drafts and only accepts known status filters', () => {
  expect(inspectionNavigation.parse({}).status).toBe('active')
  for (const status of ['active', 'archived', 'all'])
    expect(inspectionNavigation.parse({ status }).status).toBe(status)
  expect(inspectionNavigation.safeParse({ status: 'deleted' }).success).toBe(
    false,
  )
})
