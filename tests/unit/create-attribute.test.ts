import { describe, expect, it } from 'vitest'
import { createAttributeInput } from '../../lib/engine/create-attribute'
const input = {
  tenantId: 'f0000000-0000-4000-8000-000000002951',
  requestId: 'f0000000-0000-4000-8000-000000002961',
  name: 'Synthetic field',
  locale: 'en',
  dataType: 'text',
  unit: '',
  choices: [],
}
describe('attribute input', () => {
  it('requires unique options only for choice fields', () => {
    expect(
      createAttributeInput.safeParse({ ...input, dataType: 'choice' }).success,
    ).toBe(false)
    expect(
      createAttributeInput.safeParse({
        ...input,
        dataType: 'choice',
        choices: ['One', 'one'],
      }).success,
    ).toBe(false)
    expect(
      createAttributeInput.safeParse({
        ...input,
        dataType: 'choice',
        choices: ['One', 'Two'],
      }).success,
    ).toBe(true)
    expect(
      createAttributeInput.safeParse({ ...input, choices: ['One'] }).success,
    ).toBe(false)
  })
  it('permits units only for numeric fields and validates names', () => {
    expect(
      createAttributeInput.safeParse({ ...input, unit: 'cm' }).success,
    ).toBe(false)
    expect(
      createAttributeInput.safeParse({
        ...input,
        dataType: 'number',
        unit: 'cm',
      }).success,
    ).toBe(true)
    expect(
      createAttributeInput.safeParse({ ...input, name: '  ' }).success,
    ).toBe(false)
    expect(
      createAttributeInput.safeParse({ ...input, dataType: 'boolean' }).success,
    ).toBe(true)
  })
})
