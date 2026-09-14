import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createCheckoutSession,
  formEncode,
  mapStripeEvent,
  stripeConfigured,
  stripeEvent,
  verifyStripeSignature,
} from '../../extensions/stripe/api'
import { applyStripeEvent, startCheckout } from '../../lib/engine/billing'

const env = {
  STRIPE_SECRET_KEY: 'sk_test_synthetic00000000',
  STRIPE_PRICE_ID: 'price_synthetic0000',
  STRIPE_WEBHOOK_SECRET: 'whsec_synthetic0000',
}
const tenant = '10000000-0000-4000-8000-000000000001'

describe('stripe adapter', () => {
  it('recognises configuration and encodes nested forms', () => {
    expect(stripeConfigured(env)).toBe(true)
    expect(stripeConfigured({ STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false)
    const live = { ...env, STRIPE_SECRET_KEY: 'sk_live_synthetic00000000' }
    expect(stripeConfigured(live)).toBe(false)
    expect(stripeConfigured({ ...live, KOMISIO_ENVIRONMENT: 'staging' })).toBe(
      false,
    )
    expect(
      stripeConfigured({ ...live, KOMISIO_ENVIRONMENT: 'production' }),
    ).toBe(true)
    const encoded = formEncode({
      mode: 'subscription',
      line_items: [{ price: 'price_1', quantity: 1 }],
      subscription_data: { metadata: { tenant_id: tenant } },
    }).toString()
    expect(encoded).toContain('line_items%5B0%5D%5Bprice%5D=price_1')
    expect(encoded).toContain(
      `subscription_data%5Bmetadata%5D%5Btenant_id%5D=${tenant}`,
    )
  })
  it('verifies signatures within tolerance and rejects tampering', () => {
    const payload = '{"id":"evt_1"}'
    const t = Math.floor(Date.now() / 1000)
    const v1 = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
      .update(`${t}.${payload}`)
      .digest('hex')
    expect(
      verifyStripeSignature(
        payload,
        `t=${t},v1=${v1}`,
        env.STRIPE_WEBHOOK_SECRET,
      ),
    ).toBe(true)
    expect(
      verifyStripeSignature(
        payload + ' ',
        `t=${t},v1=${v1}`,
        env.STRIPE_WEBHOOK_SECRET,
      ),
    ).toBe(false)
    expect(
      verifyStripeSignature(
        payload,
        `t=${t - 600},v1=${v1}`,
        env.STRIPE_WEBHOOK_SECRET,
      ),
    ).toBe(false)
    expect(
      verifyStripeSignature(payload, null, env.STRIPE_WEBHOOK_SECRET),
    ).toBe(false)
  })
  it('maps events to plan outcomes and store ids', () => {
    const checkout = mapStripeEvent(
      stripeEvent.parse({
        id: 'evt_c',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            mode: 'subscription',
            customer: 'cus_1',
            subscription: 'sub_1',
            client_reference_id: tenant,
          },
        },
      }),
    )
    expect(checkout).toMatchObject({
      tenantId: tenant,
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      outcome: 'active',
    })
    const cancel = mapStripeEvent(
      stripeEvent.parse({
        id: 'evt_s',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_1',
            customer: { id: 'cus_1' },
            status: 'active',
            cancel_at_period_end: true,
            current_period_end: 1800000000,
            metadata: { tenant_id: tenant },
          },
        },
      }),
    )
    expect(cancel.outcome).toBe('cancel_at_period_end')
    expect(cancel.subscriptionId).toBe('sub_1')
    expect(cancel.periodEnd).toBe('2027-01-15T08:00:00.000Z')
    expect(
      mapStripeEvent(
        stripeEvent.parse({
          id: 'evt_f',
          type: 'invoice.payment_failed',
          data: { object: { id: 'in_1', subscription: 'sub_1' } },
        }),
      ).outcome,
    ).toBe('past_due')
    expect(
      mapStripeEvent(
        stripeEvent.parse({
          id: 'evt_x',
          type: 'charge.refunded',
          data: { object: { id: 'ch_1' } },
        }),
      ).outcome,
    ).toBe('none')
    expect(
      mapStripeEvent(
        stripeEvent.parse({
          id: 'evt_bad',
          type: 'checkout.session.completed',
          data: {
            object: { mode: 'subscription', client_reference_id: 'not-a-uuid' },
          },
        }),
      ).tenantId,
    ).toBeNull()
  })
  it('creates a checkout session for the owner with the tenant in the metadata', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'cs_1',
          url: 'https://checkout.stripe.com/c/1',
        }),
        { status: 200 },
      ),
    )
    const rpc = vi.fn(async () => ({ data: 'owner', error: null }))
    const client = { rpc } as unknown as SupabaseClient
    const result = await startCheckout(
      client,
      tenant,
      'owner@example.test',
      'https://app.example.test',
      env,
      http,
    )
    expect(result.url).toBe('https://checkout.stripe.com/c/1')
    const init = http.mock.calls[0][1] as RequestInit
    expect(String(init.body)).toContain(`client_reference_id=${tenant}`)
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(
      /^checkout:/,
    )
    const staff = { rpc: vi.fn(async () => ({ data: 'admin', error: null })) }
    await expect(
      startCheckout(
        staff as unknown as SupabaseClient,
        tenant,
        'x',
        'https://a',
        env,
        http,
      ),
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      createCheckoutSession(
        {},
        {
          tenantId: tenant,
          email: 'x',
          successUrl: 'a',
          cancelUrl: 'b',
          idempotencyKey: 'k',
        },
        http,
      ),
    ).rejects.toThrow('STRIPE_NOT_CONFIGURED')
  })
  it('records the mapped event through the engine', async () => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => ({
      data: { replayed: false, matched: true, state: 'active' },
      error: null,
    }))
    const result = await applyStripeEvent(
      { rpc } as unknown as SupabaseClient,
      stripeEvent.parse({
        id: 'evt_p',
        type: 'invoice.paid',
        data: { object: { id: 'in_2', subscription: 'sub_1', status: 'paid' } },
      }),
    )
    expect(result.state).toBe('active')
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_event_id: 'evt_p',
      p_subscription: 'sub_1',
      p_outcome: 'active',
    })
  })
})
