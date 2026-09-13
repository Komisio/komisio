import { expect, it } from 'vitest'
import { generateDayCloseCommand } from '../../lib/engine/day-closes'
import { intakeCommand } from '../../lib/engine/intake'

const base = {
  action: 'generateDayClose',
  tenantId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  date: '2026-09-05',
}

it('generates a day close for one calendar date', () => {
  expect(intakeCommand.parse(base).action).toBe('generateDayClose')
  expect(generateDayCloseCommand.parse(base).date).toBe('2026-09-05')
})
it('rejects timestamps and loose dates', () => {
  for (const date of ['2026-09-05T10:00:00Z', '5/9/2026', '', '2026-9-5'])
    expect(generateDayCloseCommand.safeParse({ ...base, date }).success).toBe(
      false,
    )
})
