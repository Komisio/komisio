import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSellerCommunication } from '../../lib/communications/dispatch'
import { sendSellerActivation } from '../../lib/platform/seller-activation'
vi.mock('../../lib/platform/seller-activation', () => ({
  sendSellerActivation: vi.fn(),
}))
const id = 'f0000000-0000-4000-8000-000000000001'
const input = {
  tenantId: id,
  sellerId: id,
  requestId: id,
  locale: 'en' as const,
  storeName: 'Synthetic store',
  kind: 'message' as const,
  referenceId: null,
  freeText: '',
  welcome: true as const,
}
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})
function client(
  options: {
    claim?: boolean
    cap?: boolean
    decided?: boolean
    recordError?: boolean
  } = {},
) {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test')
  vi.stubEnv('KOMISIO_AUTH_EMAIL_HOOK_ENABLED', 'true')
  const rpc = vi.fn(async (name: string) => {
    if (name === 'store_currency') return { data: 'SEK', error: null }
    if (name === 'queue_seller_communication')
      return {
        data: id,
        error: options.cap ? { message: 'EMAIL_DAILY_CAP' } : null,
      }
    if (name === 'prepare_seller_activation_email')
      return {
        data: options.claim === false ? null : 'ab'.repeat(32),
        error: null,
      }
    if (name === 'claim_seller_activation') return { data: true, error: null }
    return {
      data: id,
      error: options.recordError ? { message: 'lost reply' } : null,
    }
  })
  const from = (table: string) => {
    const chain = {
      select() {
        return chain
      },
      eq() {
        return chain
      },
      async maybeSingle() {
        return {
          error: null,
          data:
            table === 'sellers'
              ? {
                  name: 'Seller',
                  email: 'seller@example.test',
                  profile: { language: 'en' },
                }
              : null,
        }
      },
      async single() {
        return {
          error: null,
          data: {
            status: options.decided ? 'sent' : 'queued',
            recipient: 'seller@example.test',
            subject: 'Activation',
            body: 'Token-free notice',
          },
        }
      },
    }
    return chain
  }
  return { value: { from, rpc } as unknown as SupabaseClient, rpc }
}
it('retains generic Auth activation until the branded hook is enabled', async () => {
  const c = client()
  vi.stubEnv('KOMISIO_AUTH_EMAIL_HOOK_ENABLED', 'false')
  vi.mocked(sendSellerActivation).mockResolvedValueOnce({
    status: 'sent',
    providerMessageId: 'supabase-auth',
  })
  expect(await sendSellerCommunication(c.value, input)).toMatchObject({
    ok: true,
    delivery: 'sent',
  })
  expect(c.rpc).toHaveBeenCalledWith(
    'queue_seller_communication',
    expect.objectContaining({ p_template_version: 'v2' }),
  )
  expect(c.rpc).toHaveBeenCalledWith(
    'claim_seller_activation',
    expect.anything(),
  )
  expect(
    c.rpc.mock.calls.some(
      ([name]) => name === 'prepare_seller_activation_email',
    ),
  ).toBe(false)
  expect(sendSellerActivation).toHaveBeenCalledWith(
    'seller@example.test',
    'en',
    undefined,
  )
})
it('sends nothing when capped, already decided or another request claimed the send', async () => {
  for (const options of [{ cap: true }, { decided: true }, { claim: false }]) {
    const c = client(options)
    const result = await sendSellerCommunication(c.value, input)
    expect(result).toMatchObject(
      options.cap
        ? { ok: false, error: 'EMAIL_DAILY_CAP' }
        : { ok: true, delivery: options.decided ? 'sent' : 'unconfirmed' },
    )
    expect(sendSellerActivation).not.toHaveBeenCalled()
  }
})
it('records failed and uncertain activation without turning it into a successful send', async () => {
  for (const status of ['failed', 'unconfirmed'] as const) {
    vi.mocked(sendSellerActivation).mockResolvedValueOnce({
      status,
      providerMessageId: '',
    })
    const c = client()
    expect(await sendSellerCommunication(c.value, input)).toEqual({
      ok: true,
      id,
      delivery: status,
    })
    expect(c.rpc).toHaveBeenLastCalledWith(
      'record_communication_delivery',
      expect.objectContaining({ p_status: status }),
    )
  }
})
it('reports an unrecorded outcome as uncertain instead of resending Auth', async () => {
  vi.mocked(sendSellerActivation).mockResolvedValueOnce({
    status: 'sent',
    providerMessageId: 'supabase-auth',
  })
  const first = client({ recordError: true })
  expect(await sendSellerCommunication(first.value, input)).toEqual({
    ok: false,
    error: 'REQUEST_FAILED',
  })
  const retry = client({ claim: false })
  expect(await sendSellerCommunication(retry.value, input)).toEqual({
    ok: true,
    id,
    delivery: 'unconfirmed',
  })
  expect(sendSellerActivation).toHaveBeenCalledTimes(1)
})
