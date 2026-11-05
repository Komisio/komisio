import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  expoPayload,
  sendExpoPush,
  readExpoReceipts,
  type PushClaim,
} from '../../lib/push/transport'
import { runSellerPush, handleSellerPushCron } from '../../lib/push/worker'
import { renderSellerPush } from '../../lib/push/copy'
import { locales } from '../../lib/i18n'

const id = 'f0000000-0000-4000-8000-000000000767'
const claim: PushClaim = {
  id,
  token: 'ExpoPushToken[synthetic]',
  platform: 'ios',
  kind: 'item_registered',
  tenantId: id,
  sellerId: id,
  itemId: id,
  title: 'Registered',
  body: 'Test item in Test store',
}
it('uses original event sounds, bounded TTL and an identity-only navigation payload', () => {
  expect(expoPayload(claim)).toMatchObject({
    sound: 'registeredstore.wav',
    channelId: 'komisio-registered-v1',
    ttl: 3600,
    data: { v: 1, itemId: id, sellerId: id },
  })
  expect(expoPayload({ ...claim, kind: 'item_sold' })).toMatchObject({
    sound: 'sale.wav',
    channelId: 'komisio-sold-v1',
  })
  expect(expoPayload(claim).data).not.toHaveProperty('url')
})
it('records accepted tickets without claiming delivery', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ data: { status: 'ok', id } }))
  expect(
    await sendExpoPush(
      claim,
      { KOMISIO_EXPO_ACCESS_TOKEN: 'synthetic' },
      request,
    ),
  ).toEqual({ status: 'accepted', ticket: id, error: '' })
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0][1]).toMatchObject({
    redirect: 'error',
    headers: { Authorization: 'Bearer synthetic' },
  })
})
it.each([
  new Response('', { status: 503 }),
  Response.json({ data: { unexpected: true } }),
])('never retries an ambiguous send response', async (response) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response)
  expect((await sendExpoPush(claim, {}, request)).status).toBe('unconfirmed')
  expect(request).toHaveBeenCalledOnce()
})
it('sanitizes provider failures and distinguishes missing receipts', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      data: {
        status: 'error',
        message: claim.token,
        details: { error: 'DeviceNotRegistered' },
      },
    }),
  )
  expect(await sendExpoPush(claim, {}, request)).toEqual({
    status: 'failed',
    ticket: '',
    error: 'DeviceNotRegistered',
  })
  const missing = await readExpoReceipts(
    [id],
    {},
    vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: {} })),
  )
  expect(missing.get(id)).toEqual({ status: 'pending', error: '' })
  const good = await readExpoReceipts(
    [id],
    {},
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: { [id]: { status: 'ok' } } })),
  )
  expect(good.get(id)?.status).toBe('sent')
})
function fixture(outcome: 'claim' | 'lost' | 'stale', finishError = false) {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'expire_seller_push_claims') return { data: 0, error: null }
    if (name === 'seller_push_receipts') return { data: [], error: null }
    if (name === 'seller_push_candidates')
      return {
        data: [
          {
            id,
            tenantId: id,
            sellerId: id,
            itemId: id,
            kind: claim.kind,
            createdAt: '2026-11-05T12:00:00Z',
            locale: 'sv',
            storeName: 'Test store',
            itemLabel: 'Test item',
          },
        ],
        error: null,
      }
    if (name === 'claim_seller_push')
      return {
        data:
          outcome === 'claim'
            ? { ...claim, title: args!.p_subject, body: args!.p_body }
            : null,
        error: outcome === 'lost' ? {} : null,
      }
    if (name === 'finish_seller_push')
      return { data: id, error: finishError ? {} : null }
    throw new Error(name)
  })
  return { rpc, client: { rpc } as unknown as SupabaseClient }
}
it.each(['lost', 'stale'] as const)(
  'does not send after a %s claim response',
  async (outcome) => {
    const f = fixture(outcome),
      send = vi.fn()
    expect((await runSellerPush(f.client, {}, send)).attempted).toBe(0)
    expect(send).not.toHaveBeenCalled()
  },
)
it('sends frozen content once even when outcome recording fails', async () => {
  const f = fixture('claim', true),
    send = vi
      .fn()
      .mockResolvedValue({ status: 'accepted', ticket: id, error: '' })
  const r = await runSellerPush(f.client, {}, send)
  expect(r).toMatchObject({ attempted: 1, failed: true })
  expect(send).toHaveBeenCalledOnce()
  const args = f.rpc.mock.calls.find(([n]) => n === 'claim_seller_push')![1]!
  expect(send.mock.calls[0][0]).toMatchObject({
    title: args.p_subject,
    body: args.p_body,
  })
})
it('fails closed before creating a worker client when disabled or unauthenticated', async () => {
  const make = vi.fn()
  expect(
    (await handleSellerPushCron(new Request('https://example.test'), {}, make))
      .status,
  ).toBe(404)
  expect(make).not.toHaveBeenCalled()
})
it('renders both seller events in every supported language', () => {
  for (const locale of locales)
    for (const kind of ['item_registered', 'item_sold'] as const) {
      const copy = renderSellerPush(kind, locale, 'Test item', 'Test store')
      expect(copy.title).toBeTruthy()
      expect(copy.body).toContain('Test item')
      expect(copy.body).toContain('Test store')
    }
})
