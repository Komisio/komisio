import { NextResponse } from 'next/server'
import {
  parsePrivacyRequest,
  readPrivacyBody,
  verifyPrivacyHmac,
  type PrivacyTopic,
} from '@/extensions/shopify/privacy'
import {
  receiveShopifyPrivacy,
  shopifyPrivacyActor,
} from '@/lib/engine/shopify-privacy'

const topics: Record<string, PrivacyTopic> = {
  'data-request': 'customers/data_request',
  'customer-redact': 'customers/redact',
  'shop-redact': 'shop/redact',
}
export const runtime = 'nodejs'
export async function POST(
  request: Request,
  context: { params: Promise<{ topic: string }> },
) {
  const reply = (status: number) =>
    NextResponse.json(
      { received: status === 200 },
      { status, headers: { 'Cache-Control': 'no-store' } },
    )
  const slug = (await context.params).topic
  const topic = Object.hasOwn(topics, slug) ? topics[slug] : undefined
  if (!topic || !process.env.SHOPIFY_CLIENT_SECRET) return reply(404)
  let raw: Buffer
  try {
    raw = await readPrivacyBody(request)
  } catch {
    return reply(413)
  }
  if (
    !verifyPrivacyHmac(
      raw,
      request.headers.get('x-shopify-hmac-sha256'),
      process.env.SHOPIFY_CLIENT_SECRET,
    )
  )
    return reply(401)
  if (request.headers.get('x-shopify-topic') !== topic) return reply(400)
  let receipt
  try {
    receipt = parsePrivacyRequest(
      topic,
      raw,
      request.headers.get('x-shopify-shop-domain'),
      request.headers.get('x-shopify-webhook-id'),
    )
  } catch {
    return reply(400)
  }
  try {
    const client = await shopifyPrivacyActor()
    if (!client) return reply(503)
    try {
      await receiveShopifyPrivacy(client, receipt, process.env)
    } finally {
      await client.auth.signOut().catch(() => undefined)
    }
    return reply(200)
  } catch {
    // No payload, customer fields, credentials or provider headers in logs.
    return reply(503)
  }
}
