import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { confirmPayoutPaymentsCommand } from '../../lib/engine/payouts'
import { executeIntake } from '../../lib/engine/intake'
import {
  factCommunicationId,
  notificationsForIntake,
} from '../../lib/communications/dispatch'
import { confirmsIntakeResult } from '../../components/intake/confirmed-result'

const tenantId = '10000000-0000-4000-8000-000000000001'
const requestId = '20000000-0000-4000-8000-000000000002'
const payoutId = 'abcdef12-0000-4000-8000-000000000003'
const input = {
  action: 'confirmPayoutPayments' as const,
  tenantId,
  requestId,
  currency: 'SEK' as const,
  payments: [{ payoutId, amountOre: 15001, reference: ' BANK-123 ' }],
}

describe('manual payout confirmation boundary', () => {
  it('requires exact bounded rows, whole minor units and actual references', () => {
    expect(
      confirmPayoutPaymentsCommand.parse(input).payments[0].reference,
    ).toBe('BANK-123')
    for (const payments of [
      [],
      Array.from({ length: 51 }, () => input.payments[0]),
      [
        input.payments[0],
        { ...input.payments[0], payoutId: payoutId.toUpperCase() },
      ],
      [{ ...input.payments[0], amountOre: 1.5 }],
      [{ ...input.payments[0], amountOre: 100000000000 }],
      [{ ...input.payments[0], reference: '   ' }],
      [{ ...input.payments[0], reference: 'x'.repeat(201) }],
      [{ ...input.payments[0], paid: true }],
    ])
      expect(
        confirmPayoutPaymentsCommand.safeParse({ ...input, payments }).success,
      ).toBe(false)
  })
  it('executes one engine transaction and confirms only its exact batch identity', async () => {
    const command = confirmPayoutPaymentsCommand.parse(input)
    const rpc = vi.fn().mockResolvedValue({ data: requestId, error: null })
    await executeIntake({ rpc } as unknown as SupabaseClient, command)
    expect(rpc).toHaveBeenCalledExactlyOnceWith('confirm_payout_payments', {
      p_tenant: tenantId,
      p_id: requestId,
      p_currency: 'SEK',
      p_payments: command.payments,
    })
    expect(
      confirmsIntakeResult(command, {
        ok: true,
        commandId: requestId,
        id: requestId,
      }),
    ).toBe(true)
    expect(
      confirmsIntakeResult(command, {
        ok: true,
        commandId: requestId,
        id: payoutId,
      }),
    ).toBe(false)
  })
  it('uses the same per-payout notification identity as individual confirmation', async () => {
    const client = {} as SupabaseClient
    const batch = await notificationsForIntake(
      client,
      confirmPayoutPaymentsCommand.parse(input),
    )
    const single = await notificationsForIntake(client, {
      action: 'markPayoutPaid',
      tenantId,
      requestId,
      payoutId,
    })
    expect(batch).toEqual(single)
    expect(batch).toEqual([{ kind: 'payout_paid', referenceId: payoutId }])
    expect(factCommunicationId(batch[0].kind, batch[0].referenceId)).toBe(
      factCommunicationId(single[0].kind, single[0].referenceId),
    )
  })
})
