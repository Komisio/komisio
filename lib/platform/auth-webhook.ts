import { createHmac, timingSafeEqual } from 'node:crypto'

/** Standard Webhooks v1: authenticate raw bytes before parsing or using tokens. */
export function verifyAuthWebhookSignature(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const id = headers.get('webhook-id') ?? ''
  const timestamp = headers.get('webhook-timestamp') ?? ''
  if (
    !id ||
    id.length > 200 ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300
  )
    return false
  const encoded = secret.replace(/^v1,whsec_/, '').replace(/^whsec_/, '')
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return false
  const expected = createHmac('sha256', Buffer.from(encoded, 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest()
  return (headers.get('webhook-signature') ?? '').split(' ').some((entry) => {
    if (!entry.startsWith('v1,')) return false
    const actual = Buffer.from(entry.slice(3), 'base64')
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    )
  })
}
