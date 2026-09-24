import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { shopDomain } from './auth'

export const privacyTopics = [
  'customers/data_request',
  'customers/redact',
  'shop/redact',
] as const
export type PrivacyTopic = (typeof privacyTopics)[number]
const id = z
  .union([
    z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^[1-9][0-9]{0,29}$/),
  ])
  .transform(String)
const customer = z.object({
  id: id.optional(),
  email: z.string().max(320).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
})
const common = z.object({ shop_id: id, shop_domain: shopDomain })
const schemas = {
  'customers/data_request': common.extend({
    customer,
    orders_requested: z.array(id).max(10000),
    data_request: z.object({ id }),
  }),
  'customers/redact': common.extend({
    customer,
    orders_to_redact: z.array(id).max(10000),
  }),
  'shop/redact': common.strict(),
}
export function verifyPrivacyHmac(
  raw: Uint8Array,
  signature: string | null,
  secret: string,
) {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
    return false
  const expected = createHmac('sha256', secret).update(raw).digest()
  const actual = Buffer.from(signature, 'base64')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export function parsePrivacyRequest(
  topic: PrivacyTopic,
  raw: Uint8Array,
  headerShop: string | null,
  webhookId: string | null,
) {
  const payload = schemas[topic].parse(
    JSON.parse(Buffer.from(raw).toString('utf8')),
  )
  if (headerShop !== payload.shop_domain) throw new Error('SHOPIFY_WRONG_SHOP')
  const deliveryId = z.uuid().parse(webhookId)
  // Retries share a delivery ID. A later uninstall may have an identical body
  // but must create a new request. This header is an idempotency key, never authorization.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ topic, shop: payload.shop_domain, deliveryId }))
    .digest('hex')
  return {
    topic,
    shop: payload.shop_domain,
    fingerprint,
    payload: { ...payload, deliveryId },
  }
}
export async function readPrivacyBody(
  request: Pick<Request, 'body'>,
  limit = 262144,
) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('INVALID_INPUT')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('BODY_TOO_LARGE')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
