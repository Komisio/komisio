import { expect, it } from 'vitest'
import {
  factCommunicationId,
  notificationForOperation,
  notifyAfterFacts,
} from '../../lib/communications/dispatch'
import type { SupabaseClient } from '@supabase/supabase-js'

const item = '11111111-1111-4111-8111-111111111111'

it('derives one stable UUID-shaped id per fact and kind', () => {
  const a = factCommunicationId('item_accepted', item)
  expect(a).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(factCommunicationId('item_accepted', item.toUpperCase())).toBe(a)
  expect(factCommunicationId('item_sold', item)).not.toBe(a)
  expect(
    factCommunicationId(
      'item_accepted',
      '22222222-2222-4222-8222-222222222222',
    ),
  ).not.toBe(a)
})

it('maps executed staged operations to their notification', () => {
  expect(notificationForOperation('acceptItem', item, {})).toEqual({
    kind: 'item_accepted',
    referenceId: item,
  })
  expect(
    notificationForOperation('approvePayout', item, { payoutId: item }),
  ).toEqual({ kind: 'payout_approved', referenceId: item })
  expect(
    notificationForOperation('markPayoutPaid', item, { payoutId: item }),
  ).toEqual({ kind: 'payout_paid', referenceId: item })
  expect(notificationForOperation('recordReturn', item, {})).toBeNull()
  expect(notificationForOperation('approvePayout', item, {})).toBeNull()
})

it('sends nothing unless the store opted in, and never throws', async () => {
  const client = {
    from() {
      throw new Error('must not read when the policy is off')
    },
  } as unknown as SupabaseClient
  const outcomes = await notifyAfterFacts(
    client,
    { tenantId: item, storeName: 'Store', locale: 'sv', policy: {} },
    [{ kind: 'item_accepted', referenceId: item }],
  )
  expect(outcomes).toEqual([
    {
      kind: 'item_accepted',
      referenceId: item,
      status: 'skipped',
      why: 'policy',
    },
  ])
  const failing = {
    from() {
      throw new Error('database away')
    },
  } as unknown as SupabaseClient
  const failed = await notifyAfterFacts(
    failing,
    {
      tenantId: item,
      storeName: 'Store',
      locale: 'sv',
      policy: { automaticSellerNotifications: true },
    },
    [{ kind: 'item_accepted', referenceId: item }],
  )
  expect(failed[0].status).toBe('skipped')
})

it('honours seller opt-out and fails closed on a preference read error', async () => {
  for (const permission of [
    { data: false, error: null },
    { data: null, error: { message: 'unavailable' } },
  ]) {
    let reads = 0
    const chain = {
      select() {
        return this
      },
      eq() {
        return this
      },
      maybeSingle: async () => ({ data: { seller_id: item }, error: null }),
    }
    const client = {
      from() {
        reads++
        if (reads > 1) throw new Error('transport path must not run')
        return chain
      },
      rpc: async () => permission,
    } as unknown as SupabaseClient
    const result = await notifyAfterFacts(
      client,
      {
        tenantId: item,
        storeName: 'Store',
        locale: 'sv',
        policy: { automaticSellerNotifications: true },
      },
      [{ kind: 'item_accepted', referenceId: item }],
    )
    expect(result[0]).toMatchObject({
      status: 'skipped',
      why: permission.error ? 'REQUEST_FAILED' : 'seller_opt_out',
    })
    expect(reads).toBe(1)
  }
})
