import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createCreditsCheckoutSession,
  creditsPurchase,
  stripeCreditsConfigured,
  type StripeEvent,
} from '../../extensions/stripe/api'
import { applyStripeEvent } from '../../lib/engine/billing'
import {
  credits,
  readOwnKeyConfig,
  settleAssistance,
  storeOwnKey,
} from '../../lib/engine/ai-credits'
import { openAIReception } from '../../lib/assistance/openai-reception'

const env = {
  STRIPE_SECRET_KEY: 'sk_test_abcdefgh12345678',
  STRIPE_PRICE_ID: 'price_plan12345678',
  STRIPE_CREDITS_PRICE_ID: 'price_credits12345678',
  KOMISIO_CREDENTIAL_KEY: 'a'.repeat(64),
}
const tenant = '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab'

describe('AI credits', () => {
  it('shows whole kronor', () => {
    expect(credits(10000)).toBe(100)
    expect(credits(9950)).toBe(99)
  })
  it('starts a one-time Checkout with the amount in metadata', async () => {
    expect(stripeCreditsConfigured(env)).toBe(true)
    expect(
      stripeCreditsConfigured({ ...env, STRIPE_CREDITS_PRICE_ID: '' }),
    ).toBe(false)
    const http = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!init?.method)
        return new Response(
          JSON.stringify({
            active: true,
            type: 'one_time',
            currency: 'sek',
            unit_amount: 10000,
          }),
        )
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('mode')).toBe('payment')
      expect(body.get('line_items[0][price]')).toBe('price_credits12345678')
      expect(body.get('metadata[kind]')).toBe('ai_credits')
      expect(body.get('metadata[amount_ore]')).toBe('10000')
      expect(body.get('metadata[tenant_id]')).toBe(tenant)
      return new Response(
        JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/x' }),
        { status: 200 },
      )
    })
    const s = await createCreditsCheckoutSession(
      env,
      {
        tenantId: tenant,
        email: 'o@example.test',
        amountOre: 10000,
        successUrl: 'https://app/s',
        cancelUrl: 'https://app/c',
        idempotencyKey: 'k',
      },
      http as unknown as typeof fetch,
    )
    expect(s.url).toBe('https://checkout.stripe.com/x')
  })
  it('recognises a completed credits purchase and records it once through the billing actor', async () => {
    const event = {
      id: 'evt_9',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_9',
          mode: 'payment',
          status: 'complete',
          client_reference_id: tenant,
          metadata: {
            tenant_id: tenant,
            kind: 'ai_credits',
            amount_ore: '10000',
          },
        },
      },
    } as unknown as StripeEvent
    expect(creditsPurchase(event)).toEqual({
      eventId: 'evt_9',
      tenantId: tenant,
      amountOre: 10000,
    })
    expect(
      creditsPurchase({
        ...event,
        data: { object: { ...event.data.object, mode: 'subscription' } },
      } as StripeEvent),
    ).toBeNull()
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      expect(fn).toBe('record_ai_credit_purchase')
      expect(args).toEqual({
        p_event_id: 'evt_9',
        p_tenant: tenant,
        p_amount_ore: 10000,
        p_detail: { status: 'complete' },
      })
      return { data: { replayed: false, matched: true }, error: null }
    })
    const out = await applyStripeEvent(
      { rpc } as unknown as SupabaseClient,
      event,
    )
    expect(out).toEqual({ replayed: false, matched: true })
  })
  it('seals the store key before SQL sees it and opens it for the run', async () => {
    const stored: Record<string, unknown>[] = []
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'store_ai_connection') {
        stored.push(args)
        return {
          data: { provider: 'openai', model: args.p_model },
          error: null,
        }
      }
      if (fn === 'ai_connection_cipher')
        return {
          data: {
            provider: 'openai',
            model: 'gpt-4.1-mini',
            cipher: stored[0].p_cipher,
          },
          error: null,
        }
      return { data: null, error: { message: 'unexpected' } }
    })
    const client = { rpc } as unknown as SupabaseClient
    await storeOwnKey(
      client,
      {
        tenantId: tenant,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        key: 'sk-secret-secret-secret-secret',
      },
      env,
    )
    expect(JSON.stringify(stored)).not.toContain('sk-secret')
    const config = await readOwnKeyConfig(client, tenant, env)
    expect(config).toEqual({
      key: 'sk-secret-secret-secret-secret',
      model: 'gpt-4.1-mini',
    })
  })
  it('settles with the tokens the provider reported, or zero', async () => {
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
      data: { metered: true, costOre: args.p_input_tokens === 0 ? 0 : 6 },
      error: null,
    }))
    const client = { rpc } as unknown as SupabaseClient
    const request = '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ac'
    expect(
      await settleAssistance(client, tenant, request, {
        inputTokens: 10000,
        outputTokens: 1000,
      }),
    ).toEqual({ metered: true, costOre: 6 })
    expect(await settleAssistance(client, tenant, request, null)).toEqual({
      metered: true,
      costOre: 0,
    })
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_input_tokens: 0,
      p_output_tokens: 0,
    })
  })
  it('reads token usage from the provider response', async () => {
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'completed',
            usage: { input_tokens: 1234, output_tokens: 56 },
            output: [
              {
                type: 'message',
                content: [
                  {
                    type: 'output_text',
                    text: JSON.stringify({
                      metadata: {
                        description: {
                          value: 'Blue jacket',
                          sourceIds: ['0b6c4f1e-2c2e-4b5e-9a1f-1234567890ad'],
                          certainty: 'observed',
                        },
                        category: null,
                        color: null,
                        brand: null,
                        size: null,
                        material: null,
                        condition: null,
                      },
                      price: null,
                      questions: [],
                    }),
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    )
    const adapter = openAIReception(
      { key: 'k', model: 'm' },
      new Map(),
      transport as unknown as typeof fetch,
    )
    expect(adapter.usage?.()).toBeNull()
    await adapter.suggest(
      {
        sources: [
          {
            id: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ad',
            kind: 'observation',
            observation: 'blue',
            reference: 'r',
          },
        ],
      },
      new AbortController().signal,
    )
    expect(adapter.usage?.()).toEqual({ inputTokens: 1234, outputTokens: 56 })
  })
})
