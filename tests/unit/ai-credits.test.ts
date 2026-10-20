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
  publicPricing,
  readOwnKeyConfig,
  settleAssistance,
  storeOwnKey,
  startCreditsCheckout,
} from '../../lib/engine/ai-credits'
import { emptyStoreProfile } from '../../lib/engine/store-profile'
import { openAIReception } from '../../lib/assistance/openai-reception'

const env = {
  STRIPE_SECRET_KEY: 'sk_test_abcdefgh12345678',
  STRIPE_PRICE_ID: 'price_plan12345678',
  STRIPE_CREDITS_PRICE_ID: 'price_credits12345678',
  KOMISIO_CREDENTIAL_KEY: 'a'.repeat(64),
}
const tenant = '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab'

describe('AI credits', () => {
  it('records provider tax beside the fixed credit grant with the same replay key', async () => {
    const rpc = vi.fn(async () => ({
      error: null,
      data: { replayed: false, matched: true },
    }))
    const event = {
      id: 'evt_taxed_credits',
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          status: 'complete',
          amount_total: 12500,
          currency: 'sek',
          total_details: { amount_tax: 2500 },
          customer_details: {
            address: { country: 'SE', line1: 'PRIVATE' },
            tax_ids: [{ type: 'eu_vat', value: 'PRIVATE' }],
            tax_exempt: 'none',
          },
          automatic_tax: { status: 'complete' },
          metadata: {
            tenant_id: tenant,
            kind: 'ai_credits',
            amount_ore: '10000',
          },
        },
      },
    } as StripeEvent
    await applyStripeEvent({ rpc } as unknown as SupabaseClient, event)
    await applyStripeEvent({ rpc } as unknown as SupabaseClient, event)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(rpc).toHaveBeenCalledWith('record_ai_credit_purchase', {
      p_event_id: 'evt_taxed_credits',
      p_tenant: tenant,
      p_amount_ore: 10000,
      p_detail: {
        status: 'complete',
        taxMinor: 2500,
        totalMinor: 12500,
        currency: 'SEK',
        customerCountry: 'SE',
        reverseCharge: false,
        taxIdType: 'eu_vat',
        automaticTax: 'complete',
      },
    })
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('PRIVATE')
  })
  it('passes app locale through for an admin without reading the stored customer', async () => {
    const rpc = vi.fn(async (fn: string) => ({
      error: null,
      data:
        fn === 'tenant_role'
          ? 'admin'
          : fn === 'current_store_profile'
            ? {
                id: null,
                version: 0,
                publishedAt: null,
                profile: emptyStoreProfile('sv'),
              }
            : {
                enabled: true,
                period: '2026-10',
                includedOre: 10000,
                includedLeftOre: 10000,
                purchasedLeftOre: 0,
                usedThisPeriodOre: 0,
                packOre: 10000,
                ownKey: false,
                ownModel: null,
                capReached: false,
                estimatedItemsPerMonth: 500,
              },
    }))
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          active: true,
          type: 'one_time',
          currency: 'sek',
          unit_amount: 10000,
          tax_behavior: 'exclusive',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'cs_test',
          url: 'https://checkout.stripe.com/test',
        }),
      )
    await startCreditsCheckout(
      { rpc } as unknown as SupabaseClient,
      tenant,
      'admin@example.test',
      'https://app.test',
      { ...env, KOMISIO_STRIPE_AUTOMATIC_TAX: 'true' },
      http,
      'fi',
    )
    const body = new URLSearchParams(String(http.mock.calls[1][1]?.body))
    expect(body.get('locale')).toBe('fi')
    expect(body.get('customer_email')).toBe('admin@example.test')
    expect(body.has('customer')).toBe(false)
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain('billing_customer')
  })
  it('never exposes legacy store examples while preserving pricing', () => {
    const result = publicPricing.parse({
      includedOre: 10000,
      packOre: 10000,
      estimatedItemsPerMonth: 500,
      measured: true,
      stores: [{ label: 'Retired example', itemsPerMonth: 10, costOre: 200 }],
    })
    expect(result.stores).toEqual([])
    expect(result.includedOre).toBe(10000)
    expect(result.measured).toBe(true)
  })
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
        p_detail: {
          status: 'complete',
          taxMinor: null,
          totalMinor: null,
          currency: null,
          customerCountry: null,
          reverseCharge: null,
          taxIdType: null,
          automaticTax: null,
        },
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
  it('names an unusable provider answer without logging anything a person said', async () => {
    const logged: unknown[][] = []
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        logged.push(args)
      })
    const secret = 'a private observation about a customer'
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'incomplete',
            output: [
              {
                type: 'message',
                content: [{ type: 'output_text', text: secret }],
              },
            ],
          }),
          { status: 200 },
        ),
    )
    const adapter = openAIReception(
      { key: 'sk-not-a-real-key-0123456789', model: 'm' },
      new Map(),
      transport as unknown as typeof fetch,
    )
    await expect(
      adapter.suggest(
        {
          sources: [
            {
              id: '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ad',
              kind: 'observation',
              observation: secret,
              reference: 'r',
            },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('ASSISTANCE_INVALID_OUTPUT')
    expect(logged).toHaveLength(1)
    expect(logged[0][1]).toEqual({
      providerStatus: 'incomplete',
      reason: 'envelope',
    })
    expect(JSON.stringify(logged)).not.toContain(secret)
    expect(JSON.stringify(logged)).not.toContain('sk-not-a-real-key')
    expect(adapter.usage?.()).toBeNull()
    error.mockRestore()
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
                      itemType: null,
                      attributes: [
                        {
                          slug: 'description',
                          value: 'Blue jacket',
                          sourceIds: ['0b6c4f1e-2c2e-4b5e-9a1f-1234567890ad'],
                          certainty: 'observed',
                        },
                      ],
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
