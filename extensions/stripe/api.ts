import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  creditPrices,
  creditPackOre,
  type CreditCurrency,
} from '../../lib/platform/credit-prices'
import { boundedJson } from '../../lib/http/bounded-json'

// Stripe over plain fetch: hosted Checkout for the subscription, the
// customer portal for everything after, and signed webhooks for the
// outcomes. Prices and tax live in Stripe; Komisio holds three settings.
export type StripeEnvironment = Record<string, string | undefined>
const API = 'https://api.stripe.com/v1'

/** Configured, and a live key only where the deployment is production. */
export function stripeConfigured(env: StripeEnvironment) {
  const key = env.STRIPE_SECRET_KEY ?? ''
  const allowed =
    env.KOMISIO_ENVIRONMENT === 'production'
      ? /^sk_(test|live)_[A-Za-z0-9]{8,}$/
      : /^sk_test_[A-Za-z0-9]{8,}$/
  return (
    allowed.test(key) &&
    /^price_[A-Za-z0-9]{8,}$/.test(env.STRIPE_PRICE_ID ?? '')
  )
}
export function creditsPriceId(
  env: StripeEnvironment,
  currency: CreditCurrency,
) {
  return currency === 'SEK'
    ? env.STRIPE_CREDITS_PRICE_ID
    : env[`STRIPE_CREDITS_PRICE_ID_${currency}`]
}
export function stripeCreditsConfigured(
  env: StripeEnvironment,
  currency: CreditCurrency = 'SEK',
) {
  return (
    stripeConfigured(env) &&
    /^price_[A-Za-z0-9]{8,}$/.test(creditsPriceId(env, currency) ?? '')
  )
}
export function stripeWebhookConfigured(env: StripeEnvironment) {
  return /^whsec_[A-Za-z0-9]{8,}$/.test(env.STRIPE_WEBHOOK_SECRET ?? '')
}
export function stripeMode(env: StripeEnvironment): 'test' | 'live' | null {
  const key = env.STRIPE_SECRET_KEY ?? ''
  return key.startsWith('sk_live_')
    ? 'live'
    : key.startsWith('sk_test_')
      ? 'test'
      : null
}

/** Stripe's form encoding for nested fields: a[b][0][c]=v. */
export function formEncode(
  value: unknown,
  prefix = '',
  out: URLSearchParams = new URLSearchParams(),
) {
  if (value === null || value === undefined) return out
  if (Array.isArray(value))
    value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out))
  else if (typeof value === 'object')
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out)
  else out.set(prefix, String(value))
  return out
}

async function stripePost(
  env: StripeEnvironment,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  http: typeof fetch,
) {
  let response: Response
  try {
    response = await http(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
        'Stripe-Version': '2024-06-20',
      },
      body: formEncode(body).toString(),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('STRIPE_REQUEST_FAILED')
  }
  if (!response.ok) throw new Error('STRIPE_REQUEST_FAILED')
  return boundedJson(response, 262144)
}

const session = z.object({ id: z.string(), url: z.string().url() })

/** Hosted Checkout for one store: the tenant id travels as reference and subscription metadata. */
export async function createCheckoutSession(
  env: StripeEnvironment,
  input: {
    tenantId: string
    email: string
    successUrl: string
    cancelUrl: string
    idempotencyKey: string
  },
  http: typeof fetch = globalThis.fetch,
) {
  if (!stripeConfigured(env)) throw new Error('STRIPE_NOT_CONFIGURED')
  const data = await stripePost(
    env,
    '/checkout/sessions',
    {
      mode: 'subscription',
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: input.tenantId,
      customer_email: input.email,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'sv',
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      subscription_data: { metadata: { tenant_id: input.tenantId } },
      metadata: { tenant_id: input.tenantId },
    },
    input.idempotencyKey,
    http,
  )
  return session.parse(data)
}

/** One-time Checkout for a pack of AI credits; the amount travels in metadata for the webhook. */
export async function createCreditsCheckoutSession(
  env: StripeEnvironment,
  input: {
    tenantId: string
    email: string
    amountOre: number
    currency?: CreditCurrency
    successUrl: string
    cancelUrl: string
    idempotencyKey: string
  },
  http: typeof fetch = globalThis.fetch,
) {
  const currency = input.currency ?? 'SEK'
  if (!stripeCreditsConfigured(env, currency))
    throw new Error('STRIPE_NOT_CONFIGURED')
  if (input.amountOre !== creditPackOre) throw new Error('INVALID_INPUT')
  const priceId = creditsPriceId(env, currency)!
  const expected = creditPrices[currency]
  let priceResponse: Response
  try {
    priceResponse = await http(`${API}/prices/${priceId}`, {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Stripe-Version': '2024-06-20',
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('STRIPE_REQUEST_FAILED')
  }
  if (!priceResponse.ok) throw new Error('STRIPE_REQUEST_FAILED')
  const price = z
    .object({
      active: z.boolean(),
      type: z.string(),
      currency: z.string(),
      unit_amount: z.number().int().nullable(),
    })
    .parse(await boundedJson(priceResponse, 262144))
  if (
    !price.active ||
    price.type !== 'one_time' ||
    price.currency !== currency.toLowerCase() ||
    price.unit_amount !== expected.amountMinor
  )
    throw new Error('STRIPE_NOT_CONFIGURED')
  const data = await stripePost(
    env,
    '/checkout/sessions',
    {
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: input.tenantId,
      customer_email: input.email,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: 'auto',
      currency: currency.toLowerCase(),
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      metadata: {
        tenant_id: input.tenantId,
        kind: 'ai_credits',
        amount_ore: String(input.amountOre),
        payment_currency: currency,
        payment_amount_minor: String(expected.amountMinor),
      },
    },
    input.idempotencyKey,
    http,
  )
  return session.parse(data)
}
/** Pure: a completed credits purchase in an event, or null. */
export function creditsPurchase(event: StripeEvent) {
  const o = event.data.object
  if (
    event.type !== 'checkout.session.completed' ||
    o.mode !== 'payment' ||
    o.metadata?.kind !== 'ai_credits'
  )
    return null
  const tenantId = o.metadata.tenant_id ?? o.client_reference_id ?? ''
  const amountOre = Number(o.metadata.amount_ore ?? '')
  if (
    !/^[0-9a-f-]{36}$/.test(tenantId) ||
    !Number.isInteger(amountOre) ||
    amountOre <= 0
  )
    return null
  return { eventId: event.id, tenantId, amountOre }
}
export async function createPortalSession(
  env: StripeEnvironment,
  input: { customerId: string; returnUrl: string; idempotencyKey: string },
  http: typeof fetch = globalThis.fetch,
) {
  if (!stripeConfigured(env)) throw new Error('STRIPE_NOT_CONFIGURED')
  const data = await stripePost(
    env,
    '/billing_portal/sessions',
    { customer: input.customerId, return_url: input.returnUrl },
    input.idempotencyKey,
    http,
  )
  return session.parse(data)
}

/** Stripe-Signature: t=<unix>,v1=<hex>[,v1=...]; five-minute tolerance. */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  now = Date.now(),
) {
  if (!header || !secret) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false
  const expected = createHmac('sha256', secret)
    .update(`${parts.t}.${payload}`)
    .digest('hex')
  return header
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .some((p) => {
      const given = p.trim().slice(3)
      return (
        given.length === expected.length &&
        timingSafeEqual(Buffer.from(given), Buffer.from(expected))
      )
    })
}

const idOrObject = z
  .union([z.string(), z.object({ id: z.string() })])
  .transform((v) => (typeof v === 'string' ? v : v.id))
  .nullable()
  .optional()
export const stripeEvent = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(100),
  data: z.object({
    object: z
      .object({
        id: z.string().optional(),
        object: z.string().optional(),
        customer: idOrObject,
        subscription: idOrObject,
        client_reference_id: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        cancel_at_period_end: z.boolean().nullable().optional(),
        current_period_end: z.number().nullable().optional(),
        mode: z.string().nullable().optional(),
        metadata: z.record(z.string(), z.string()).nullable().optional(),
      })
      .passthrough(),
  }),
})
export type StripeEvent = z.infer<typeof stripeEvent>

export type BillingOutcome =
  'active' | 'past_due' | 'read_only' | 'cancel_at_period_end' | 'none'

/** Pure: which plan outcome an event means, and the ids that name the store. */
export function mapStripeEvent(event: StripeEvent) {
  const o = event.data.object
  const tenantId = o.metadata?.tenant_id ?? o.client_reference_id ?? null
  const base = {
    eventId: event.id,
    type: event.type,
    tenantId: tenantId && /^[0-9a-f-]{36}$/.test(tenantId) ? tenantId : null,
    customerId: o.customer ?? null,
    subscriptionId: event.type.startsWith('customer.subscription.')
      ? (o.id ?? null)
      : (o.subscription ?? null),
    periodEnd: o.current_period_end
      ? new Date(o.current_period_end * 1000).toISOString()
      : null,
  }
  let outcome: BillingOutcome = 'none'
  switch (event.type) {
    case 'checkout.session.completed':
      outcome = o.mode === 'subscription' ? 'active' : 'none'
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      outcome =
        o.status === 'active' || o.status === 'trialing'
          ? o.cancel_at_period_end
            ? 'cancel_at_period_end'
            : 'active'
          : o.status === 'past_due' || o.status === 'unpaid'
            ? 'past_due'
            : o.status === 'canceled' || o.status === 'incomplete_expired'
              ? 'read_only'
              : 'none'
      break
    case 'customer.subscription.deleted':
      outcome = 'read_only'
      break
    case 'invoice.paid':
      outcome = 'active'
      break
    case 'invoice.payment_failed':
      outcome = 'past_due'
      break
  }
  return { ...base, outcome }
}
