import { z } from 'zod'

export const pushClaim = z
  .strictObject({
    id: z.uuid(),
    token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/),
    platform: z.enum(['ios', 'android']),
    kind: z.enum([
      'item_registered',
      'item_sold',
      'external_item_offered',
      'external_item_declined',
    ]),
    tenantId: z.uuid(),
    sellerId: z.uuid().nullable(),
    itemId: z.guid().nullable(),
    requestId: z.uuid().nullable().optional(),
    ownerId: z.uuid().nullable().optional(),
    offerId: z.uuid().nullable().optional(),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(1000),
  })
  .refine((c) =>
    c.kind.startsWith('external_')
      ? c.sellerId === null &&
        c.itemId === null &&
        !!c.requestId &&
        !!c.ownerId &&
        (c.kind === 'external_item_offered' ? !!c.offerId : c.offerId == null)
      : !!c.sellerId &&
        !!c.itemId &&
        c.requestId == null &&
        c.ownerId == null &&
        c.offerId == null,
  )
export type PushClaim = z.infer<typeof pushClaim>
export type PushSend = {
  status: 'accepted' | 'failed' | 'unconfirmed'
  ticket: string
  error: string
}
const knownErrors = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
  'DeveloperError',
])
function providerError(value: unknown) {
  return typeof value === 'string' && knownErrors.has(value)
    ? value
    : 'PROVIDER_ERROR'
}
function headers(env: Record<string, string | undefined>) {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(env.KOMISIO_EXPO_ACCESS_TOKEN
      ? { Authorization: `Bearer ${env.KOMISIO_EXPO_ACCESS_TOKEN}` }
      : {}),
  }
}
export function expoPayload(c: PushClaim) {
  const external = c.kind.startsWith('external_')
  return {
    to: c.token,
    title: c.title,
    body: c.body,
    sound: external
      ? 'default'
      : c.kind === 'item_registered'
        ? 'registeredstore.wav'
        : 'sale.wav',
    channelId: external
      ? 'komisio-requests-v1'
      : c.kind === 'item_registered'
        ? 'komisio-registered-v1'
        : 'komisio-sold-v1',
    ttl: 3600,
    data: external
      ? {
          v: 2,
          notificationId: c.id,
          kind: c.kind,
          tenantId: c.tenantId,
          ownerId: c.ownerId,
          requestId: c.requestId,
          offerId: c.offerId ?? null,
        }
      : {
          v: 1,
          notificationId: c.id,
          kind: c.kind,
          tenantId: c.tenantId,
          sellerId: c.sellerId,
          itemId: c.itemId,
        },
  }
}
export async function sendExpoPush(
  c: PushClaim,
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): Promise<PushSend> {
  const body = JSON.stringify(expoPayload(pushClaim.parse(c)))
  if (Buffer.byteLength(body, 'utf8') > 4096)
    return { status: 'failed', ticket: '', error: 'MessageTooBig' }
  try {
    const response = await request('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      redirect: 'error',
      headers: headers(env),
      body,
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      return {
        status: response.status >= 500 ? 'unconfirmed' : 'failed',
        ticket: '',
        error: `HTTP_${response.status}`,
      }
    const text = await response.text()
    if (text.length > 65536) throw new Error('RESPONSE_TOO_LARGE')
    const data: unknown = JSON.parse(text)
    const ticket = z
      .object({
        data: z.discriminatedUnion('status', [
          z.object({ status: z.literal('ok'), id: z.uuid() }),
          z.object({
            status: z.literal('error'),
            details: z.object({ error: z.string() }).optional(),
          }),
        ]),
      })
      .parse(data).data
    return ticket.status === 'ok'
      ? { status: 'accepted', ticket: ticket.id, error: '' }
      : {
          status: 'failed',
          ticket: '',
          error: providerError(ticket.details?.error),
        }
  } catch {
    return { status: 'unconfirmed', ticket: '', error: 'TRANSPORT_UNCONFIRMED' }
  }
}
export type PushReceipt = {
  status: 'sent' | 'failed' | 'pending'
  error: string
}
export async function readExpoReceipts(
  ids: string[],
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): Promise<Map<string, PushReceipt>> {
  z.array(z.uuid()).min(1).max(100).parse(ids)
  const response = await request(
    'https://exp.host/--/api/v2/push/getReceipts',
    {
      method: 'POST',
      redirect: 'error',
      headers: headers(env),
      body: JSON.stringify({ ids }),
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new Error('PUSH_RECEIPTS_FAILED')
  const text = await response.text()
  if (text.length > 131072) throw new Error('PUSH_RECEIPTS_FAILED')
  const data = z
    .object({ data: z.record(z.string(), z.unknown()) })
    .parse(JSON.parse(text)).data
  const result = new Map<string, PushReceipt>()
  for (const id of ids) {
    if (!Object.hasOwn(data, id)) {
      result.set(id, { status: 'pending', error: '' })
      continue
    }
    const receipt = z
      .discriminatedUnion('status', [
        z.object({ status: z.literal('ok') }),
        z.object({
          status: z.literal('error'),
          details: z.object({ error: z.string() }).optional(),
        }),
      ])
      .parse(data[id])
    result.set(
      id,
      receipt.status === 'ok'
        ? { status: 'sent', error: '' }
        : { status: 'failed', error: providerError(receipt.details?.error) },
    )
  }
  return result
}
