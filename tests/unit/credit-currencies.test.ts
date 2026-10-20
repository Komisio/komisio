import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  creditPriceForCountry,
  creditPrices,
  formatCreditPrice,
} from '../../lib/platform/credit-prices'
import {
  createCreditsCheckoutSession,
  stripeCreditsConfigured,
  creditsPurchase,
  formEncode,
} from '../../extensions/stripe/api'
import { startCreditsCheckout } from '../../lib/engine/ai-credits'
import {
  emptyStoreProfile,
  storeProfileBody,
} from '../../lib/engine/store-profile'

const env = {
  STRIPE_SECRET_KEY: 'sk_test_abcdefgh12345678',
  STRIPE_PRICE_ID: 'price_plan12345678',
  STRIPE_CREDITS_PRICE_ID: 'price_sek12345678',
  STRIPE_CREDITS_PRICE_ID_NOK: 'price_nok12345678',
  STRIPE_CREDITS_PRICE_ID_DKK: 'price_dkk12345678',
  STRIPE_CREDITS_PRICE_ID_EUR: 'price_eur12345678',
  STRIPE_CREDITS_PRICE_ID_USD: 'price_usd12345678',
}
const tenant = '0b6c4f1e-2c2e-4b5e-9a1f-1234567890ab'
const input = {
  tenantId: tenant,
  email: 'owner@example.test',
  amountOre: 10000,
  successUrl: 'https://app.test/s',
  cancelUrl: 'https://app.test/c',
  idempotencyKey: 'test',
}
describe('fixed credit currencies', () => {
  it.each([
    ['SE', 'SEK'],
    ['NO', 'NOK'],
    ['DK', 'DKK'],
    ['FI', 'EUR'],
    ['DE', 'EUR'],
    ['ES', 'EUR'],
    ['IT', 'EUR'],
    ['GB', 'EUR'],
    ['US', 'USD'],
    ['CA', 'EUR'],
    ['AU', 'EUR'],
    ['BR', 'EUR'],
  ] as const)(
    'selects %s from the store profile',
    async (country, currency) => {
      const price = creditPriceForCountry(country)
      expect(price.currency).toBe(currency)
      const profile = emptyStoreProfile('en')
      profile.address.country = country
      const rpc = vi.fn(async (fn: string) => ({
        error: null,
        data:
          fn === 'tenant_role'
            ? 'owner'
            : fn === 'current_store_profile'
              ? { id: null, version: 0, publishedAt: null, profile }
              : {
                  enabled: true,
                  period: '2026-09',
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
      const http = vi.fn(async (url: unknown, init?: RequestInit) => {
        if (!init?.method) {
          expect(
            String(url).endsWith(`/price_${currency.toLowerCase()}12345678`),
          ).toBe(true)
          return Response.json({
            active: true,
            type: 'one_time',
            currency: currency.toLowerCase(),
            unit_amount: price.amountMinor,
          })
        }
        const body = new URLSearchParams(String(init.body))
        expect(body.get('currency')).toBe(currency.toLowerCase())
        expect(body.get('locale')).toBe('auto')
        expect(body.get('line_items[0][price]')).toBe(
          `price_${currency.toLowerCase()}12345678`,
        )
        expect(body.get('metadata[amount_ore]')).toBe('10000')
        expect(body.get('metadata[payment_amount_minor]')).toBe(
          String(price.amountMinor),
        )
        expect(
          (init.headers as Record<string, string>)['Idempotency-Key'],
        ).toContain(`:${currency}:`)
        return Response.json({
          id: 'cs_test',
          url: 'https://checkout.stripe.com/test',
        })
      })
      await expect(
        startCreditsCheckout(
          { rpc } as unknown as SupabaseClient,
          tenant,
          input.email,
          'https://app.test',
          env,
          http,
        ),
      ).resolves.toEqual({ url: 'https://checkout.stripe.com/test' })
      expect(http).toHaveBeenCalledTimes(2)
    },
  )
  it('preserves legacy Swedish profiles and rejects unknown countries', () => {
    expect(creditPriceForCountry()).toEqual(creditPrices.SEK)
    expect(() => creditPriceForCountry('ZZ')).toThrow('INVALID_INPUT')
    expect(storeProfileBody.safeParse(emptyStoreProfile('en')).success).toBe(
      true,
    )
    const p = emptyStoreProfile('en')
    expect(
      storeProfileBody.safeParse({
        ...p,
        address: { ...p.address, country: 'ZZ' },
      }).success,
    ).toBe(false)
    expect(formatCreditPrice(creditPrices.EUR, 'en')).toContain('9')
    expect(formatCreditPrice(creditPrices.DKK, 'sv')).toContain('65')
  })
  it('does not fall back to SEK when the selected currency is unconfigured', async () => {
    const missing = { ...env, STRIPE_CREDITS_PRICE_ID_NOK: undefined }
    expect(stripeCreditsConfigured(missing, 'NOK')).toBe(false)
    const http = vi.fn()
    await expect(
      createCreditsCheckoutSession(
        missing,
        { ...input, currency: 'NOK' },
        http,
      ),
    ).rejects.toThrow('STRIPE_NOT_CONFIGURED')
    expect(http).not.toHaveBeenCalled()
  })
  it.each([
    { active: false, type: 'one_time', currency: 'eur', unit_amount: 900 },
    { active: true, type: 'recurring', currency: 'eur', unit_amount: 900 },
    { active: true, type: 'one_time', currency: 'sek', unit_amount: 900 },
    { active: true, type: 'one_time', currency: 'eur', unit_amount: 10000 },
  ])(
    'refuses a Stripe price that does not match the displayed offer',
    async (price) => {
      const http = vi.fn(async () => Response.json(price))
      await expect(
        createCreditsCheckoutSession(env, { ...input, currency: 'EUR' }, http),
      ).rejects.toThrow('STRIPE_NOT_CONFIGURED')
      expect(http).toHaveBeenCalledTimes(1)
    },
  )
  it('never treats payment minor units as the credit grant', () => {
    expect(
      creditsPurchase({
        id: 'evt_eur',
        type: 'checkout.session.completed',
        data: {
          object: {
            mode: 'payment',
            currency: 'eur',
            amount_total: 900,
            metadata: {
              kind: 'ai_credits',
              tenant_id: tenant,
              amount_ore: '10000',
            },
          },
        },
      })?.amountOre,
    ).toBe(10000)
  })
})

describe('credit pack tax parameters', () => {
  it.each([undefined, 'false', 'TRUE', 'true'])(
    'keeps currencies and grants fixed with flag %s',
    async (flag) => {
      for (const currency of ['SEK', 'NOK', 'DKK', 'EUR', 'USD'] as const) {
        const price = creditPrices[currency]
        const http = vi
          .fn<typeof fetch>()
          .mockImplementation(async (_url, init) => {
            if (!init?.method)
              return Response.json({
                active: true,
                type: 'one_time',
                currency: currency.toLowerCase(),
                unit_amount: price.amountMinor,
                tax_behavior: 'exclusive',
              })
            const expected = {
              mode: 'payment',
              line_items: [
                {
                  price: `price_${currency.toLowerCase()}12345678`,
                  quantity: 1,
                },
              ],
              client_reference_id: tenant,
              customer_email: input.email,
              success_url: input.successUrl,
              cancel_url: input.cancelUrl,
              locale: 'da',
              currency: currency.toLowerCase(),
              billing_address_collection: 'required',
              tax_id_collection: { enabled: true },
              metadata: {
                tenant_id: tenant,
                kind: 'ai_credits',
                amount_ore: '10000',
                payment_currency: currency,
                payment_amount_minor: String(price.amountMinor),
              },
              ...(flag === 'true'
                ? {
                    automatic_tax: { enabled: true },
                    customer_creation: 'always',
                    invoice_creation: { enabled: true },
                  }
                : {}),
            }
            expect(init.body).toBe(formEncode(expected).toString())
            return Response.json({
              id: 'cs_test',
              url: 'https://checkout.stripe.com/test',
            })
          })
        await createCreditsCheckoutSession(
          { ...env, KOMISIO_STRIPE_AUTOMATIC_TAX: flag },
          { ...input, currency, locale: 'dk' },
          http,
        )
        expect(http).toHaveBeenCalledTimes(2)
      }
    },
  )
  it.each([undefined, null, 'inclusive', 'unspecified'])(
    'rejects %s only with automatic tax enabled',
    async (tax_behavior) => {
      for (const enabled of [false, true]) {
        const http = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            Response.json({
              active: true,
              type: 'one_time',
              currency: 'sek',
              unit_amount: 10000,
              tax_behavior,
            }),
          )
          .mockResolvedValueOnce(
            Response.json({
              id: 'cs_test',
              url: 'https://checkout.stripe.com/test',
            }),
          )
        const call = createCreditsCheckoutSession(
          { ...env, KOMISIO_STRIPE_AUTOMATIC_TAX: String(enabled) },
          input,
          http,
        )
        if (enabled) {
          await expect(call).rejects.toThrow('STRIPE_TAX_MISCONFIGURED')
          expect(http).toHaveBeenCalledTimes(1)
        } else {
          await expect(call).resolves.toMatchObject({ id: 'cs_test' })
          expect(http).toHaveBeenCalledTimes(2)
        }
      }
    },
  )
})
