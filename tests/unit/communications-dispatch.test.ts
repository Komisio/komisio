import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import {
  factCommunicationId,
  notificationsForOperation,
  notifyAfterFacts,
  settlementPayoutIds,
  sendSellerCommunication,
} from '../../lib/communications/dispatch'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dictionary, type Locale } from '../../lib/i18n'
import { emptyStoreProfile } from '../../lib/engine/store-profile'
import { defaultStorePolicy } from '../../lib/engine/store-policy'

const item = '11111111-1111-4111-8111-111111111111'

function messageClient(
  sellerLanguage: unknown,
  storeLanguage?: Locale,
  defaultLanguage?: Locale,
) {
  let queued: Record<string, unknown> = {}
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'current_store_profile')
      return {
        data: {
          id: null,
          version: 0,
          publishedAt: null,
          profile: storeLanguage ? emptyStoreProfile(storeLanguage) : null,
        },
        error: null,
      }
    if (name === 'store_currency') return { data: 'DKK', error: null }
    if (name === 'current_store_policy')
      return {
        data: {
          id: null,
          version: 0,
          policy: {
            ...defaultStorePolicy(),
            communicationLanguage: defaultLanguage,
          },
        },
        error: null,
      }
    if (name === 'queue_seller_communication') queued = args
    return { data: item, error: null }
  })
  const client = {
    rpc,
    from(table: string) {
      const data =
        table === 'sellers'
          ? {
              name: 'Synthetic Seller',
              email: 'synthetic@example.test',
              profile: { language: sellerLanguage },
            }
          : table === 'payouts'
            ? { amount_ore: '123457', paid_at: '2026-10-20T22:30:00Z' }
            : table === 'settlement_statements'
              ? { number: 3, closing_ore: '123457' }
              : {
                  status: 'manual',
                  recipient: 'synthetic@example.test',
                  subject: 'Historical subject',
                  body: 'Historical body',
                }
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle: async () => ({ data, error: null }),
        single: async () => ({ data, error: null }),
      }
    },
  } as unknown as SupabaseClient
  return { client, rpc, queued: () => queued }
}

it.each([
  ['fi', 'dk', 'fi'],
  [undefined, 'dk', 'dk'],
  ['unsupported', 'no', 'no'],
  [undefined, undefined, 'en'],
] as const)(
  'queues the actual language: seller %s, store %s → %s',
  async (seller, store, expected) => {
    for (const kind of ['payout_paid', 'statement_issued'] as const) {
      const f = messageClient(seller, store)
      expect(
        await sendSellerCommunication(f.client, {
          tenantId: item,
          storeName: 'Synthetic Store',
          requestId: item,
          sellerId: item,
          kind,
          referenceId: item,
          freeText: '',
        }),
      ).toMatchObject({ ok: true, delivery: 'manual' })
      expect(f.queued().p_locale).toBe(expected)
      expect(f.queued().p_template_version).toBe('v2')
      expect(f.queued().p_subject).toContain('Synthetic Store')
      expect(f.queued().p_body).toContain(
        dictionary(expected).communications.templates.footer.replace(
          '{store}',
          'Synthetic Store',
        ),
      )
      expect(
        f.rpc.mock.calls.filter(
          ([name]) => name === 'record_communication_delivery',
        ),
      ).toHaveLength(0)
    }
  },
)

it('records English when an entire requested template falls back', async () => {
  const copy = dictionary('fi').communications.templates.payout_paid
  const previous = copy.body
  copy.body = ''
  try {
    const f = messageClient('fi', 'dk')
    await sendSellerCommunication(f.client, {
      tenantId: item,
      storeName: 'Synthetic Store',
      requestId: item,
      sellerId: item,
      kind: 'payout_paid',
      referenceId: item,
      freeText: 'Store-written text',
    })
    expect(f.queued().p_locale).toBe('en')
    expect(f.queued().p_body).toContain('Hello Synthetic Seller')
    expect(f.queued().p_body).toContain('DKK\u00a01,234.57')
    expect(f.queued().p_body).toContain('Store-written text')
  } finally {
    copy.body = previous
  }
})

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

it('maps executed staged operations to their notifications', () => {
  expect(notificationsForOperation('acceptItem', item, {})).toEqual([
    { kind: 'item_accepted', referenceId: item },
  ])
  expect(
    notificationsForOperation('approvePayout', item, { payoutId: item }),
  ).toEqual([{ kind: 'payout_approved', referenceId: item }])
  expect(
    notificationsForOperation('markPayoutPaid', item, { payoutId: item }),
  ).toEqual([{ kind: 'payout_paid', referenceId: item }])
  expect(notificationsForOperation('recordReturn', item, {})).toEqual([])
  expect(notificationsForOperation('approvePayout', item, {})).toEqual([])
})

it('derives settlement payout ids exactly as the engine does', () => {
  // derived_id('<batch>:<seller>'): md5 hex in 8-4-4-4-12 with version 5 and variant 8.
  const batch = '22222222-2222-4222-8222-222222222222'
  const ids = settlementPayoutIds(batch, [{ sellerId: item }])
  expect(ids).toEqual([
    createHash('md5')
      .update(`${batch}:${item}`)
      .digest('hex')
      .replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12})$/, '$1-$2-5$3-8$4-$5'),
  ])
  expect(ids[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  )
  expect(
    settlementPayoutIds(batch, [{ sellerId: item.toUpperCase() }]),
  ).toEqual(ids)
  expect(settlementPayoutIds(batch, 'nonsense')).toEqual([])
  expect(
    notificationsForOperation('settlePayouts', batch, {
      sellers: [{ sellerId: item, amountOre: 100 }],
      reason: 'x',
    }),
  ).toEqual([{ kind: 'payout_approved', referenceId: ids[0] }])
})

it('sends nothing unless the store opted in, and never throws', async () => {
  const client = {
    from() {
      throw new Error('must not read when the policy is off')
    },
  } as unknown as SupabaseClient
  const outcomes = await notifyAfterFacts(
    client,
    { tenantId: item, storeName: 'Store', policy: {} },
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
