import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  creditPrices,
  creditPackOre,
  type CreditCurrency,
} from '../../lib/platform/credit-prices'
import { boundedJson } from '../../lib/http/bounded-json'
import { storeCountries } from '../../lib/platform/countries'

// Stripe over plain fetch: hosted Checkout for the subscription, the
// customer portal for everything after, and signed webhooks for the
// outcomes. Prices and tax live in Stripe; Komisio holds three settings.
export type StripeEnvironment = Record<string, string | undefined>
const API = 'https://api.stripe.com/v1'

export function stripeAutomaticTax(env: StripeEnvironment) {
  return env.KOMISIO_STRIPE_AUTOMATIC_TAX === 'true'
}

export function stripeLocale(locale?: string) {
  const mapping: Record<string, string> = {
    sv: 'sv',
    no: 'nb',
    dk: 'da',
    fi: 'fi',
    de: 'de',
    es: 'es',
    it: 'it',
    en: 'en',
  }
  return locale && Object.hasOwn(mapping, locale) ? mapping[locale] : 'auto'
}

async function stripeGet(
  env: StripeEnvironment,
  path: string,
  http: typeof fetch,
) {
  let response: Response
  try {
    response = await http(`${API}${path}`, {
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
  if (!response.ok) throw new Error('STRIPE_REQUEST_FAILED')
  return boundedJson(response, 262144)
}

const priceSchema = z.object({
  active: z.boolean(),
  type: z.string(),
  currency: z.string(),
  unit_amount: z.number().int().nullable(),
  tax_behavior: z.unknown().optional(),
})

async function checkTaxSubscription(
  env: StripeEnvironment,
  customerId: string | null | undefined,
  http: typeof fetch,
) {
  const price = priceSchema.parse(
    await stripeGet(env, `/prices/${env.STRIPE_PRICE_ID}`, http),
  )
  if (price.tax_behavior !== 'exclusive')
    throw new Error('STRIPE_TAX_MISCONFIGURED')
  if (!price.active || price.type !== 'recurring')
    throw new Error('STRIPE_NOT_CONFIGURED')
  if (!customerId) return
  if (!/^cus_[A-Za-z0-9]+$/.test(customerId))
    throw new Error('STRIPE_REQUEST_FAILED')
  const customer = z
    .object({
      id: z.literal(customerId),
      deleted: z.literal(false).optional(),
      shipping: z
        .object({ address: z.record(z.string(), z.unknown()).nullable() })
        .nullable(),
    })
    .parse(await stripeGet(env, `/customers/${customerId}`, http))
  if (customer.shipping?.address)
    throw new Error('STRIPE_CUSTOMER_ADDRESS_CONFLICT')
}

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
    locale?: string
    customerId?: string | null
  },
  http: typeof fetch = globalThis.fetch,
) {
  if (!stripeConfigured(env)) throw new Error('STRIPE_NOT_CONFIGURED')
  const automaticTax = stripeAutomaticTax(env)
  if (automaticTax) await checkTaxSubscription(env, input.customerId, http)
  const data = await stripePost(
    env,
    '/checkout/sessions',
    {
      mode: 'subscription',
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: input.tenantId,
      ...(automaticTax && input.customerId
        ? {
            customer: input.customerId,
            customer_update: { address: 'auto', name: 'auto' },
          }
        : { customer_email: input.email }),
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      locale: stripeLocale(input.locale),
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      subscription_data: { metadata: { tenant_id: input.tenantId } },
      metadata: { tenant_id: input.tenantId },
      ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
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
    locale?: string
  },
  http: typeof fetch = globalThis.fetch,
) {
  const currency = input.currency ?? 'SEK'
  if (!stripeCreditsConfigured(env, currency))
    throw new Error('STRIPE_NOT_CONFIGURED')
  if (input.amountOre !== creditPackOre) throw new Error('INVALID_INPUT')
  const priceId = creditsPriceId(env, currency)!
  const expected = creditPrices[currency]
  const price = priceSchema.parse(
    await stripeGet(env, `/prices/${priceId}`, http),
  )
  const automaticTax = stripeAutomaticTax(env)
  if (automaticTax && price.tax_behavior !== 'exclusive')
    throw new Error('STRIPE_TAX_MISCONFIGURED')
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
      locale: stripeLocale(input.locale),
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
      ...(automaticTax
        ? {
            automatic_tax: { enabled: true },
            customer_creation: 'always',
            invoice_creation: { enabled: true },
          }
        : {}),
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
const customerOrId = z
  .union([
    z.string(),
    z.object({ id: z.string(), tax_exempt: z.string().nullable().optional() }),
  ])
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
        customer: customerOrId,
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

const minorUnits = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER)
  .nullish()
  .catch(null)
const taxStatus = z.enum(['none', 'exempt', 'reverse']).nullish().catch(null)
const taxCountry = z
  .string()
  .regex(/^[a-zA-Z]{2}$/)
  .transform((v) => v.toUpperCase())
  .pipe(z.enum(storeCountries))
  .nullish()
  .catch(null)
const taxIds = z
  .array(
    z
      .object({
        type: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/),
      })
      .passthrough(),
  )
  .nullish()
  .catch(null)
const taxAmounts = z
  .array(
    z
      .object({
        amount: minorUnits,
        taxability_reason: z.string().max(80).nullish().catch(null),
      })
      .passthrough(),
  )
  .nullish()
  .catch(null)
const taxFields = z
  .object({
    amount_total: minorUnits,
    total: minorUnits,
    tax: minorUnits,
    currency: z
      .string()
      .regex(/^[a-zA-Z]{3}$/)
      .transform((v) => v.toUpperCase())
      .nullish()
      .catch(null),
    customer_tax_exempt: taxStatus,
    customer: z
      .union([z.string(), z.object({ tax_exempt: taxStatus }).passthrough()])
      .nullish()
      .catch(null),
    customer_address: z
      .object({ country: taxCountry })
      .passthrough()
      .nullish()
      .catch(null),
    customer_tax_ids: taxIds,
    customer_details: z
      .object({
        address: z
          .object({ country: taxCountry })
          .passthrough()
          .nullish()
          .catch(null),
        tax_exempt: taxStatus,
        tax_ids: taxIds,
      })
      .passthrough()
      .nullish()
      .catch(null),
    automatic_tax: z
      .object({ status: z.string().max(80).nullish().catch(null) })
      .passthrough()
      .nullish()
      .catch(null),
    total_details: z
      .object({
        amount_tax: minorUnits,
        breakdown: z
          .object({ taxes: taxAmounts })
          .passthrough()
          .nullish()
          .catch(null),
      })
      .passthrough()
      .nullish()
      .catch(null),
    total_tax_amounts: taxAmounts,
  })
  .passthrough()

/** Only provider facts, never a rate calculation or an inference from country/VAT ID. */
export function taxSummary(event: StripeEvent) {
  if (!['checkout.session.completed', 'invoice.paid'].includes(event.type))
    return {}
  const o = taxFields.parse(event.data.object)
  const checkout = event.type === 'checkout.session.completed'
  const amounts = checkout
    ? o.total_details?.breakdown?.taxes
    : o.total_tax_amounts
  const exempt =
    (checkout ? o.customer_details?.tax_exempt : o.customer_tax_exempt) ??
    (typeof o.customer === 'object' ? o.customer?.tax_exempt : null)
  const reasons =
    amounts?.map((a) => a.taxability_reason).filter((r) => r != null) ?? []
  const totalTax =
    amounts?.length && amounts.every((a) => a.amount != null)
      ? amounts.reduce((sum, a) => sum + a.amount!, 0)
      : null
  return {
    taxMinor: checkout
      ? (o.total_details?.amount_tax ?? null)
      : (o.tax ??
        (totalTax != null && Number.isSafeInteger(totalTax) ? totalTax : null)),
    totalMinor: (checkout ? o.amount_total : o.total) ?? null,
    currency: o.currency ?? null,
    customerCountry:
      (checkout
        ? o.customer_details?.address?.country
        : o.customer_address?.country) ?? null,
    reverseCharge:
      exempt === 'reverse' || reasons.includes('reverse_charge')
        ? true
        : exempt != null || reasons.length > 0
          ? false
          : null,
    taxIdType:
      (checkout ? o.customer_details?.tax_ids : o.customer_tax_ids)?.[0]
        ?.type ?? null,
    automaticTax: o.automatic_tax?.status ?? null,
  }
}

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
    customerId:
      typeof o.customer === 'object'
        ? (o.customer?.id ?? null)
        : (o.customer ?? null),
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
