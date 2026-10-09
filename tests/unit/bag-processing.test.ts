import { expect, it } from 'vitest'
import { setBagProcessingCommand } from '../../lib/engine/bag-processing'
const command = {
  action: 'setBagProcessing',
  tenantId: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  bagId: '10000000-0000-4000-8000-000000000003',
  expectedVersion: 0,
  state: 'completed',
  reason: '',
}
it('requires explicit version and a reason to reopen, never client actor identity', () => {
  expect(setBagProcessingCommand.safeParse(command).success).toBe(true)
  for (const bad of [
    { ...command, createdBy: command.tenantId },
    { ...command, state: 'open' },
    { ...command, expectedVersion: -1 },
    { ...command, expectedVersion: undefined },
  ])
    expect(setBagProcessingCommand.safeParse(bad).success).toBe(false)
  expect(
    setBagProcessingCommand.parse({
      ...command,
      state: 'open',
      reason: '  Found another item  ',
    }).reason,
  ).toBe('Found another item')
})
