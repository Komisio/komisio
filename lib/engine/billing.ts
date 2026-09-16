import { z } from 'zod'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  createCheckoutSession,
  createPortalSession,
  creditsPurchase,
  mapStripeEvent,
  stripeConfigured,
  type StripeEnvironment,
  type StripeEvent,
} from '../../extensions/stripe/api'
import { automationIdentity } from './automation'
import { supabaseEnv } from '../supabase/env'

// Billing through Stripe (plans slice 3). Owners start Checkout and open
// the portal under their own session; webhook outcomes are recorded by the
// billing actor, the deployment's automation identity registered by the
// operator, through record_billing_event.
async function requireOwner(client: SupabaseClient, tenantId: string) {
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || role.data !== 'owner') throw new Error('FORBIDDEN')
}

export async function startCheckout(
  client: SupabaseClient,
  tenantInput: string,
  email: string,
  origin: string,
  env: StripeEnvironment,
  http?: typeof fetch,
) {
  const tenantId = z.uuid().parse(tenantInput)
  await requireOwner(client, tenantId)
  if (!stripeConfigured(env)) throw new Error('STRIPE_NOT_CONFIGURED')
  const session = await createCheckoutSession(
    env,
    {
      tenantId,
      email,
      successUrl: `${origin}/settings?billing=success`,
      cancelUrl: `${origin}/settings?billing=cancelled`,
      idempotencyKey: `checkout:${tenantId}:${Math.floor(Date.now() / 60000)}`,
    },
    http,
  )
  return { url: session.url }
}

export async function openPortal(
  client: SupabaseClient,
  tenantInput: string,
  origin: string,
  env: StripeEnvironment,
  http?: typeof fetch,
) {
  const tenantId = z.uuid().parse(tenantInput)
  await requireOwner(client, tenantId)
  const r = await client.rpc('billing_customer', { p_tenant: tenantId })
  if (r.error) throw new Error('FORBIDDEN')
  const customer = z
    .object({ customerId: z.string().nullable() })
    .nullable()
    .parse(r.data)
  if (!customer?.customerId) throw new Error('NO_CUSTOMER')
  const session = await createPortalSession(
    env,
    {
      customerId: customer.customerId,
      returnUrl: `${origin}/settings`,
      idempotencyKey: `portal:${tenantId}:${Math.floor(Date.now() / 60000)}`,
    },
    http,
  )
  return { url: session.url }
}

/** A client signed in as the billing actor; null when the identity is not configured. */
export async function billingActorClient(
  env: Record<string, string | undefined> = process.env,
) {
  const identity = automationIdentity(env)
  if (!identity) return null
  const { url, key } = supabaseEnv()
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signIn = await client.auth.signInWithPassword(identity)
  if (signIn.error) throw new Error('BILLING_ACTOR_UNAVAILABLE')
  return client
}

/** Records one event's outcome; replay by event id is a no-op in the database. */
export async function applyStripeEvent(
  client: SupabaseClient,
  event: StripeEvent,
) {
  const purchase = creditsPurchase(event)
  if (purchase) {
    const p = await client.rpc('record_ai_credit_purchase', {
      p_event_id: purchase.eventId,
      p_tenant: purchase.tenantId,
      p_amount_ore: purchase.amountOre,
      p_detail: { status: event.data.object.status ?? null },
    })
    if (p.error) throw new Error(p.error.message)
    return outcome.parse(p.data)
  }
  const mapped = mapStripeEvent(event)
  const r = await client.rpc('record_billing_event', {
    p_event_id: mapped.eventId,
    p_type: mapped.type,
    p_tenant: mapped.tenantId,
    p_customer: mapped.customerId,
    p_subscription: mapped.subscriptionId,
    p_outcome: mapped.outcome,
    p_period_end: mapped.periodEnd,
    p_detail: { status: event.data.object.status ?? null },
  })
  if (r.error) throw new Error(r.error.message)
  return outcome.parse(r.data)
}
const outcome = z.object({
  replayed: z.boolean(),
  matched: z.boolean().optional(),
  state: z.string().optional(),
})

export const billingErrorCodes = [
  'FORBIDDEN',
  'STRIPE_NOT_CONFIGURED',
  'STRIPE_REQUEST_FAILED',
  'NO_CUSTOMER',
  'BILLING_DISABLED',
  'BILLING_ACTOR_UNAVAILABLE',
] as const
export function billingErrorCode(message: string) {
  return billingErrorCodes.find((c) => c === message) ?? 'REQUEST_FAILED'
}
