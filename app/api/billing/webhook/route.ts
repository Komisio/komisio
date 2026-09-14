import { NextResponse } from 'next/server'
import {
  stripeEvent,
  stripeWebhookConfigured,
  verifyStripeSignature,
} from '@/extensions/stripe/api'
import { applyStripeEvent, billingActorClient } from '@/lib/engine/billing'

/**
 * Stripe webhook. The signature is checked against the raw body before
 * anything is parsed; the outcome is recorded by the billing actor, once per
 * event id. Unknown event types are acknowledged and recorded as no change.
 */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (!stripeWebhookConfigured(process.env))
    return reply({ error: 'NOT_FOUND' }, 404)
  if (Number(request.headers.get('content-length') ?? 0) > 262144)
    return reply({ error: 'INVALID_INPUT' }, 413)
  const payload = await request.text()
  if (payload.length > 262144) return reply({ error: 'INVALID_INPUT' }, 413)
  if (
    !verifyStripeSignature(
      payload,
      request.headers.get('stripe-signature'),
      process.env.STRIPE_WEBHOOK_SECRET ?? '',
    )
  )
    return reply({ error: 'SIGNATURE_INVALID' }, 400)
  let event
  try {
    event = stripeEvent.parse(JSON.parse(payload))
  } catch {
    return reply({ error: 'INVALID_INPUT' }, 400)
  }
  try {
    const client = await billingActorClient()
    if (!client) return reply({ error: 'BILLING_ACTOR_UNAVAILABLE' }, 503)
    try {
      const outcome = await applyStripeEvent(client, event)
      return reply({ received: true, ...outcome })
    } finally {
      await client.auth.signOut().catch(() => undefined)
    }
  } catch (e) {
    // A 5xx makes Stripe retry; the event id keeps the retry idempotent.
    console.error('Billing webhook failed', {
      eventId: event.id,
      code: e instanceof Error ? e.message : 'unknown',
    })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
