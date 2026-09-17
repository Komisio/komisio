import { it, expect } from 'vitest'
import {
  exactPrice,
  manualReceptionSources,
  readManualReception,
} from '../../lib/engine/manual-reception'
it('normalizes a proposed price without floating point arithmetic', () => {
  expect(exactPrice('250')).toBe('250.00')
  expect(exactPrice('0,01')).toBe('0.01')
  expect(exactPrice('12.5')).toBe('12.50')
  expect(() => exactPrice('1,234')).toThrow()
  expect(() => exactPrice('0')).toThrow()
  expect(() => exactPrice('1e4')).toThrow()
})
it('preserves external evidence and gives corrections new source IDs', () => {
  const other = {
    id: crypto.randomUUID(),
    kind: 'observation' as const,
    reference: 'External',
    observation: 'Evidence',
  }
  const input = {
    description: 'Blue jacket',
    amount: '250.00',
    reference: 'Appraisal',
    rationale: 'Condition and comparable sale',
  }
  const first = manualReceptionSources(
    [other],
    input,
    crypto.randomUUID(),
    crypto.randomUUID(),
  )
  const second = manualReceptionSources(
    first,
    { ...input, description: 'Red jacket' },
    crypto.randomUUID(),
    crypto.randomUUID(),
  )
  expect(second).toHaveLength(3)
  expect(second[0]).toEqual(other)
  expect(second[1].id).not.toBe(first[1].id)
  expect(readManualReception(first)?.suggestions.price?.amount).toBe('250.00')
  expect(
    readManualReception(second)?.suggestions.attributes.find(
      (a) => a.slug === 'description',
    )?.value,
  ).toBe('Red jacket')
})
it('does not invent a price from arbitrary appraisal prose', () => {
  expect(
    readManualReception([
      {
        id: crypto.randomUUID(),
        kind: 'price-evidence',
        reference: 'Appraisal',
        observation: 'Maybe 250 SEK',
      },
    ]),
  ).toBeNull()
})
