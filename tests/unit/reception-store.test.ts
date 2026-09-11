import { expect, it } from 'vitest'
import { intakeCommand } from '../../lib/engine/intake'
const id = '10000000-0000-4000-8000-000000000001'
const source = {
  id,
  kind: 'observation',
  reference: 'staff note',
  observation: 'Blue jacket',
}
it('accepts bounded staff source commands and rejects unsupported authority/photos', () => {
  const command = {
    action: 'saveReceptionSources',
    tenantId: id,
    requestId: id,
    sessionId: id,
    expectedRevision: 0,
    sources: [source],
  }
  expect(intakeCommand.safeParse(command).success).toBe(true)
  for (const patch of [
    { expectedRevision: -1 },
    { sources: [] },
    { sources: [source, source] },
    { sources: [{ ...source, kind: 'photo' }] },
    { approved: true },
  ])
    expect(intakeCommand.safeParse({ ...command, ...patch }).success).toBe(
      false,
    )
})
