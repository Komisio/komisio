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
  stripeAutomaticTax,
  stripeLocale,
  taxSummary,
} from '../../extensions/stripe/api'
import {
  applyStripeEvent,
  startCheckout,
  billingErrorCode,
} from '../../lib/engine/billing'

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

const checkoutInput = {
  tenantId: tenant,
  email: 'owner@example.test',
  successUrl: 'https://app.test/s',
  cancelUrl: 'https://app.test/c',
  idempotencyKey: 'synthetic',
}
const exclusivePlan = {
  active: true,
  type: 'recurring',
  currency: 'sek',
  unit_amount: 29900,
  tax_behavior: 'exclusive',
}
const checkoutResult = {
  id: 'cs_synthetic',
  url: 'https://checkout.stripe.com/synthetic',
}
const taxEnv = { ...env, KOMISIO_STRIPE_AUTOMATIC_TAX: 'true' }

describe('Stripe Tax subscription boundary', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', ' true '])(
    'keeps the legacy request byte-for-byte with flag %s',
    async (flag) => {
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(checkoutResult))
      const rpc = vi.fn(async () => ({ data: 'owner', error: null }))
      await startCheckout(
        { rpc } as unknown as SupabaseClient,
        tenant,
        checkoutInput.email,
        'https://app.test',
        { ...env, KOMISIO_STRIPE_AUTOMATIC_TAX: flag },
        http,
        'sv',
      )
      expect(stripeAutomaticTax({ KOMISIO_STRIPE_AUTOMATIC_TAX: flag })).toBe(
        false,
      )
      expect(rpc.mock.calls).toHaveLength(1)
      expect(http).toHaveBeenCalledTimes(1)
      expect(http.mock.calls[0][1]?.body).toBe(
        formEncode({
          mode: 'subscription',
          line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
          client_reference_id: tenant,
          customer_email: checkoutInput.email,
          success_url: 'https://app.test/settings?billing=success',
          cancel_url: 'https://app.test/settings?billing=cancelled',
          locale: 'sv',
          billing_address_collection: 'required',
          tax_id_collection: { enabled: true },
          subscription_data: { metadata: { tenant_id: tenant } },
          metadata: { tenant_id: tenant },
        }).toString(),
      )
    },
  )
  it.each([
    ['sv', 'sv'],
    ['no', 'nb'],
    ['dk', 'da'],
    ['fi', 'fi'],
    ['en', 'en'],
    ['de', 'de'],
    ['es', 'es'],
    ['it', 'it'],
    ['xx', 'auto'],
    ['constructor', 'auto'],
  ])('maps locale %s to %s', (locale, expected) => {
    expect(stripeLocale(locale)).toBe(expected)
  })
  it.each([undefined, null, 'unspecified', 'inclusive'])(
    'refuses tax behavior %s before creating a session',
    async (tax_behavior) => {
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ ...exclusivePlan, tax_behavior }))
      await expect(
        createCheckoutSession(taxEnv, checkoutInput, http),
      ).rejects.toThrow('STRIPE_TAX_MISCONFIGURED')
      expect(http).toHaveBeenCalledTimes(1)
      expect(billingErrorCode('STRIPE_TAX_MISCONFIGURED')).toBe(
        'STRIPE_TAX_MISCONFIGURED',
      )
    },
  )
  it.each([null, 'cus_existing'])(
    'uses the owner-scoped stored customer %s only when tax is enabled',
    async (customerId) => {
      const rpc = vi.fn(async (fn: string) => ({
        data: fn === 'tenant_role' ? 'owner' : { customerId },
        error: null,
      }))
      const http = vi
        .fn<typeof fetch>()
        .mockImplementation(async (url, init) => {
          if (String(url).includes('/prices/'))
            return Response.json(exclusivePlan)
          if (String(url).includes('/customers/'))
            return Response.json({ id: customerId, shipping: null })
          const body = new URLSearchParams(String(init?.body))
          expect(body.get('automatic_tax[enabled]')).toBe('true')
          expect(body.get('billing_address_collection')).toBe('required')
          expect(body.get('tax_id_collection[enabled]')).toBe('true')
          expect(body.has('tax_id_collection[required]')).toBe(false)
          expect(body.get('locale')).toBe('nb')
          expect(body.get('customer')).toBe(customerId)
          expect(body.get('customer_email')).toBe(
            customerId ? null : checkoutInput.email,
          )
          expect(body.get('customer_update[address]')).toBe(
            customerId ? 'auto' : null,
          )
          expect(body.get('customer_update[name]')).toBe(
            customerId ? 'auto' : null,
          )
          return Response.json(checkoutResult)
        })
      await startCheckout(
        { rpc } as unknown as SupabaseClient,
        tenant,
        checkoutInput.email,
        'https://app.test',
        taxEnv,
        http,
        'no',
      )
      expect(rpc.mock.calls.map((c) => c[0])).toEqual([
        'tenant_role',
        'billing_customer',
      ])
      expect(http).toHaveBeenCalledTimes(customerId ? 3 : 2)
    },
  )
  it('refuses a saved shipping address without changing customer data', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        Response.json(
          String(url).includes('/prices/')
            ? exclusivePlan
            : { id: 'cus_existing', shipping: { address: { country: 'SE' } } },
        ),
      )
    await expect(
      createCheckoutSession(
        taxEnv,
        { ...checkoutInput, customerId: 'cus_existing' },
        http,
      ),
    ).rejects.toThrow('STRIPE_CUSTOMER_ADDRESS_CONFLICT')
    expect(http).toHaveBeenCalledTimes(2)
    expect(http.mock.calls.every((c) => !c[1]?.method)).toBe(true)
    expect(billingErrorCode('STRIPE_CUSTOMER_ADDRESS_CONFLICT')).toBe(
      'STRIPE_CUSTOMER_ADDRESS_CONFLICT',
    )
  })
  it('fails closed on customer lookup failures and malformed/deleted customers', async () => {
    for (const response of [
      Response.json({}, { status: 503 }),
      Response.json({ id: 'cus_existing', deleted: true }),
      Response.json({ id: 'cus_other', shipping: null }),
    ]) {
      const http = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(exclusivePlan))
        .mockResolvedValueOnce(response)
      await expect(
        createCheckoutSession(
          taxEnv,
          { ...checkoutInput, customerId: 'cus_existing' },
          http,
        ),
      ).rejects.toThrow()
      expect(http).toHaveBeenCalledTimes(2)
    }
  })
})

describe('provider-only tax summary', () => {
  const event = (
    object: Record<string, unknown>,
    type = 'checkout.session.completed',
  ) => stripeEvent.parse({ id: 'evt_tax', type, data: { object } })
  it.each([
    ['SE', 7475, 37375, 'none', 'eu_vat', false],
    ['DE', 0, 29900, 'reverse', 'eu_vat', true],
    ['DE', 5681, 35581, 'none', null, false],
    ['NO', 7475, 37375, 'none', null, false],
    ['US', 2392, 32292, 'none', null, false],
  ])(
    'records the synthetic %s result, without calculating from its country',
    (country, tax, total, exempt, idType, reverse) => {
      const summary = taxSummary(
        event({
          amount_total: total,
          currency: 'sek',
          total_details: { amount_tax: tax },
          customer_details: {
            address: { country, line1: 'PRIVATE ADDRESS' },
            tax_exempt: exempt,
            tax_ids: idType ? [{ type: idType, value: 'PRIVATE VAT ID' }] : [],
          },
          automatic_tax: { status: 'complete' },
        }),
      )
      expect(summary).toEqual({
        taxMinor: tax,
        totalMinor: total,
        currency: 'SEK',
        customerCountry: country,
        reverseCharge: reverse,
        taxIdType: idType,
        automaticTax: 'complete',
      })
      expect(JSON.stringify(summary)).not.toContain('PRIVATE')
    },
  )
  it('does not infer reverse charge from zero tax, a VAT ID or country', () => {
    expect(
      taxSummary(
        event({
          amount_total: 100,
          total_details: { amount_tax: 0 },
          customer_details: {
            address: { country: 'DE' },
            tax_ids: [{ type: 'eu_vat', value: 'secret' }],
          },
        }),
      ),
    ).toMatchObject({ taxMinor: 0, reverseCharge: null })
    expect(taxSummary(event({}))).toEqual({
      taxMinor: null,
      totalMinor: null,
      currency: null,
      customerCountry: null,
      reverseCharge: null,
      taxIdType: null,
      automaticTax: null,
    })
  })
  it('reads invoice snapshots and expanded customer reverse status while keeping ID routing', async () => {
    const e = event(
      {
        customer: {
          id: 'cus_synthetic',
          tax_exempt: 'reverse',
          address: { line1: 'PRIVATE' },
        },
        customer_address: { country: 'de', line1: 'PRIVATE' },
        customer_tax_ids: [{ type: 'eu_vat', value: 'PRIVATE' }],
        total: 29900,
        tax: 0,
        currency: 'sek',
        automatic_tax: { status: 'complete' },
        status: 'paid',
      },
      'invoice.paid',
    )
    expect(mapStripeEvent(e).customerId).toBe('cus_synthetic')
    const rpc = vi.fn(async () => ({ error: null, data: { replayed: false } }))
    await applyStripeEvent({ rpc } as unknown as SupabaseClient, e)
    expect(rpc).toHaveBeenCalledWith(
      'record_billing_event',
      expect.objectContaining({
        p_customer: 'cus_synthetic',
        p_detail: {
          status: 'paid',
          taxMinor: 0,
          totalMinor: 29900,
          currency: 'SEK',
          customerCountry: 'DE',
          reverseCharge: true,
          taxIdType: 'eu_vat',
          automaticTax: 'complete',
        },
      }),
    )
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('PRIVATE')
  })
  it('reads explicit taxability reasons, preserves nulls, and rejects unsafe minor units', () => {
    expect(
      taxSummary(
        event({
          total_details: {
            breakdown: {
              taxes: [{ amount: 0, taxability_reason: 'reverse_charge' }],
            },
          },
        }),
      ),
    ).toMatchObject({ reverseCharge: true })
    expect(
      taxSummary(
        event(
          {
            total_tax_amounts: [
              { amount: 100, taxability_reason: 'standard_rated' },
              { amount: 25 },
            ],
            total: 625,
          },
          'invoice.paid',
        ),
      ),
    ).toMatchObject({ taxMinor: 125, reverseCharge: false, totalMinor: 625 })
    expect(
      taxSummary(
        event(
          {
            total_tax_amounts: [{ amount: 100 }, { amount: 'bad' }],
            total: 1.25,
            currency: 'invalid',
          },
          'invoice.paid',
        ),
      ),
    ).toMatchObject({
      taxMinor: null,
      totalMinor: null,
      currency: null,
      reverseCharge: null,
    })
    expect(
      taxSummary(event({ tax: Number.MAX_SAFE_INTEGER + 1 }, 'invoice.paid')),
    ).toMatchObject({ taxMinor: null })
    expect(
      taxSummary(event({ tax: -100, total: -500 }, 'invoice.paid')),
    ).toMatchObject({ taxMinor: -100, totalMinor: -500 })
    expect(
      taxSummary(
        event({ customer: { id: 'cus_synthetic', tax_exempt: 'reverse' } }),
      ),
    ).toMatchObject({ reverseCharge: true })
    expect(taxSummary(event({}, 'customer.subscription.updated'))).toEqual({})
  })
})
