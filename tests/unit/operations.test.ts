import { it, expect } from 'vitest'
import {
  proposeOperationCommand,
  decideOperationCommand,
  operationErrorCode,
} from '../../lib/engine/operations'
const id = '20000000-0000-4000-8000-000000000001'
const payload = {
  sessionId: id,
  sourceRevision: 1,
  previousReviewId: null,
  agreementId: id,
  expiresAt: '2026-09-13T00:00:00Z',
  suggestions: {
    attributes: [
      {
        slug: 'description',
        definitionVersion: 1,
        value: 'Jacket',
        sourceIds: [id],
        certainty: 'observed',
      },
    ],
    price: {
      currency: 'SEK',
      amount: '250.00',
      rationale: 'TEST',
      sourceIds: [id],
    },
    questions: [],
  },
}
const command = {
  tenantId: id,
  requestId: id,
  kind: 'publishReceptionReview',
  payload,
  actorLabel: 'komisio-mcp',
  expiresAt: '2026-09-13T00:00:00Z',
}
it('accepts a complete proposal and rejects authority, risk or unknown kinds', () => {
  expect(proposeOperationCommand.safeParse(command).success).toBe(true)
  for (const patch of [
    { kind: 'deleteTenant' },
    { riskLevel: 'low' },
    { approved: true },
    { actorLabel: '' },
    { payload: { ...payload, executeNow: true } },
    {
      payload: {
        ...payload,
        suggestions: { ...payload.suggestions, price: null },
      },
    },
    {
      payload: {
        ...payload,
        suggestions: {
          ...payload.suggestions,
          attributes: [
            {
              slug: 'description',
              definitionVersion: 1,
              value: 'Jacket',
              sourceIds: [id],
              certainty: 'tentative',
            },
          ],
        },
      },
    },
  ])
    expect(
      proposeOperationCommand.safeParse({ ...command, ...patch }).success,
    ).toBe(false)
})
it('requires an explicit approve or reject decision bound to one operation', () => {
  const decision = {
    tenantId: id,
    requestId: id,
    operationId: id,
    decision: 'approve',
  }
  expect(decideOperationCommand.parse(decision).reason).toBe('')
  expect(
    decideOperationCommand.safeParse({ ...decision, decision: 'execute' })
      .success,
  ).toBe(false)
  expect(
    decideOperationCommand.safeParse({ ...decision, reason: 'x'.repeat(501) })
      .success,
  ).toBe(false)
  expect(
    decideOperationCommand.safeParse({ ...decision, actorId: id }).success,
  ).toBe(false)
})
it('maps database messages to stable codes without leaking detail', () => {
  expect(operationErrorCode('error: OPERATION_DECIDED at line 3')).toBe(
    'OPERATION_DECIDED',
  )
  expect(operationErrorCode('permission denied for table x')).toBe(
    'REQUEST_FAILED',
  )
})
