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
