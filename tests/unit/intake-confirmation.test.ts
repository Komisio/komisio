import { describe, expect, it } from 'vitest'
import { intakeCommand } from '../../lib/engine/intake'
import { confirmsIntakeResult } from '../../components/intake/confirmed-result'

const tenantId = '10000000-0000-4000-8000-000000000001'
const requestId = '10000000-0000-4000-8000-000000000002'
const otherId = '10000000-0000-4000-8000-000000000003'
const command = (fields: object) =>
  intakeCommand.parse({ tenantId, requestId, ...fields })
const reply = (id: unknown) => ({ ok: true, commandId: requestId, id })
const purchase = command({
  action: 'registerPurchase',
  supplierNote: 'Synthetic',
  purchasePrice: '10.00',
  evidenceReference: 'Synthetic evidence',
  marginEligible: false,
})

describe('intake result confirmation', () => {
  it('binds an ordinary receipt to both the command and its recorded ID', () => {
    expect(
      confirmsIntakeResult(purchase, {
        ...reply(requestId),
        notifications: [],
      }),
    ).toBe(true)
  })
  it.each([
    null,
    undefined,
    '',
    [],
    {},
    { ok: false, commandId: requestId, id: requestId },
    { ok: true, id: requestId },
    { ok: true, commandId: otherId, id: requestId },
    { ok: true, commandId: requestId },
    reply(null),
    reply({ id: requestId }),
    reply(otherId),
  ])('keeps malformed or unrelated replies unconfirmed (%j)', (value) => {
    expect(confirmsIntakeResult(purchase, value)).toBe(false)
  })
  it.each([
    {
      action: 'recordSale',
      provider: 'manual',
      externalId: 'synthetic-sale',
      occurredAt: '2026-10-03T10:00:00Z',
      currency: 'SEK',
      lines: [{ itemId: otherId, price: '10.00' }],
    },
    { action: 'generateDayClose', date: '2026-10-03' },
    { action: 'exportDayClose', dayCloseId: otherId },
  ])(
    'allows canonical existing IDs for $action while requiring this command',
    (fields) => {
      const input = command(fields)
      expect(confirmsIntakeResult(input, reply(otherId))).toBe(true)
      expect(
        confirmsIntakeResult(input, { ...reply(otherId), commandId: otherId }),
      ).toBe(false)
      expect(confirmsIntakeResult(input, reply('not-an-id'))).toBe(false)
    },
  )
  it('checks the complete transfer destination and recorded references', () => {
    const input = command({
      action: 'transferItem',
      itemId: requestId,
      toTenantId: otherId,
      note: '',
    })
    const saved = {
      transferred: true,
      replayed: false,
      toTenant: otherId,
      sellerId: requestId,
      bagId: requestId,
      draftId: requestId,
    }
    expect(confirmsIntakeResult(input, reply(saved))).toBe(true)
    expect(
      confirmsIntakeResult(input, reply({ ...saved, replayed: true })),
    ).toBe(true)
    for (const patch of [
      { transferred: false },
      { toTenant: tenantId },
      { bagId: null },
      { draftId: 'missing' },
      { sellerId: '' },
      { replayed: null },
    ])
      expect(confirmsIntakeResult(input, reply({ ...saved, ...patch }))).toBe(
        false,
      )
  })
  it('confirms a recorded markdown run even when no item was due', () => {
    const input = command({ action: 'applyDueMarkdowns' })
    const saved = {
      runId: requestId,
      appliedCount: 0,
      applied: [],
      replayed: false,
    }
    expect(confirmsIntakeResult(input, reply(saved))).toBe(true)
    expect(
      confirmsIntakeResult(input, reply({ ...saved, replayed: true })),
    ).toBe(true)
    expect(
      confirmsIntakeResult(input, reply({ ...saved, runId: otherId })),
    ).toBe(false)
    expect(
      confirmsIntakeResult(input, reply({ ...saved, appliedCount: 1 })),
    ).toBe(false)
  })
  it('checks confirmed label dimensions against the submitted settings', () => {
    const input = command({
      action: 'setLabelFormat',
      kind: 'item',
      widthMm: 60,
      heightMm: 40,
    })
    const saved = { kind: 'item', widthMm: 60, heightMm: 40, custom: true }
    expect(confirmsIntakeResult(input, reply(saved))).toBe(true)
    for (const patch of [
      { kind: 'bag' },
      { widthMm: 59 },
      { heightMm: 39 },
      { custom: false },
    ])
      expect(confirmsIntakeResult(input, reply({ ...saved, ...patch }))).toBe(
        false,
      )
  })
  it('retains the template and cancellation result contracts', () => {
    const input = command({
      action: 'setLabelTemplate',
      kind: 'item',
      name: 'Synthetic label',
      zpl: '^XA^XZ',
    })
    const saved = {
      id: otherId,
      kind: 'item',
      name: 'Synthetic label',
      version: 1,
    }
    expect(confirmsIntakeResult(input, reply(saved))).toBe(true)
    expect(confirmsIntakeResult(input, reply({ ...saved, kind: 'bag' }))).toBe(
      false,
    )
    expect(confirmsIntakeResult(input, reply({ ...saved, version: 0 }))).toBe(
      false,
    )
    const reset = command({ action: 'resetLabelTemplate', kind: 'item' })
    expect(confirmsIntakeResult(reset, reply(false))).toBe(true)
    expect(confirmsIntakeResult(reset, reply(true))).toBe(true)
    expect(confirmsIntakeResult(reset, reply(null))).toBe(false)
    const cancel = command({ action: 'cancelPrintJob', jobId: otherId })
    expect(confirmsIntakeResult(cancel, reply(otherId))).toBe(true)
    expect(confirmsIntakeResult(cancel, reply(requestId))).toBe(false)
  })
})
