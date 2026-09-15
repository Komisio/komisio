import { expect, it } from 'vitest'
import { z } from 'zod'
import { derivedId } from '../../lib/engine/quick-intake'

it('derives RFC 4122 shaped ids that the readers accept, deterministically', () => {
  const a = derivedId('40000000-0000-4000-8000-000000000001', 'session')
  expect(a).toBe(derivedId('40000000-0000-4000-8000-000000000001', 'session'))
  expect(a).not.toBe(derivedId('40000000-0000-4000-8000-000000000001', 'item'))
  expect(z.uuid().safeParse(a).success).toBe(true)
  expect(a).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})
