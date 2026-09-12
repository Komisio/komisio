import { expect, it } from 'vitest'
import { intakeCommand } from '../../lib/engine/intake'
const id = '10000000-0000-4000-8000-000000000001'
const source = {
  id,
  kind: 'observation',
  reference: 'staff note',
  observation: 'Blue jacket',
}
it('accepts bounded staff sources and rejects authority or malformed photo paths', () => {
  const command = {
    action: 'saveReceptionSources',
    tenantId: id,
    requestId: id,
    sessionId: id,
    expectedRevision: 0,
    sources: [source],
  }
  expect(intakeCommand.safeParse(command).success).toBe(true)
  expect(
    intakeCommand.safeParse({
      ...command,
      sources: [
        { ...source, kind: 'photo', reference: `${id}/${id}/${id}.png` },
      ],
    }).success,
  ).toBe(true)
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

it('requires a complete explicit review command rather than inferred approval', () => {
  const command = {
    action: 'publishReceptionReview',
    tenantId: id,
    requestId: id,
    sessionId: id,
    sourceRevision: 1,
    previousReviewId: null,
    agreementId: id,
    expiresAt: '2026-09-13T00:00:00Z',
    suggestions: {
      metadata: {
        description: {
          value: 'Jacket',
          sourceIds: [id],
          certainty: 'observed',
        },
      },
      price: {
        currency: 'SEK',
        amount: '250.00',
        rationale: 'TEST',
        sourceIds: [id],
      },
      questions: [],
    },
  }
  expect(intakeCommand.safeParse(command).success).toBe(true)
  for (const patch of [
    { previousReviewId: undefined },
    { suggestions: { ...command.suggestions, price: null } },
    { suggestions: { ...command.suggestions, questions: ['Need evidence'] } },
    { approved: true },
  ])
    expect(intakeCommand.safeParse({ ...command, ...patch }).success).toBe(
      false,
    )
})
