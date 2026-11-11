import { z } from 'zod'
import { verifyAuthWebhookSignature } from './auth-webhook'

type Env = Record<string, string | undefined>
const eventSchema = z.object({
  user: z.object({ phone: z.string().regex(/^\+?[1-9]\d{6,14}$/) }),
  sms: z.object({ otp: z.string().regex(/^\d{6,10}$/) }),
})
const probeSchema = z
  .object({ type: z.literal('komisio-auth-sms-probe') })
  .strict()
const acceptedSchema = z.object({
  id: z.string().regex(/^s[a-f0-9]{32}$/),
  status: z.enum(['created', 'sent', 'delivered']),
  direction: z.literal('outgoing'),
  to: z.string(),
  from: z.literal('Komisio'),
})

/** Auth owns code generation, expiry and verification; this only transports SMS. */
export async function handleAuthSms(
  raw: string,
  headers: Headers,
  env: Env = process.env,
  request: typeof fetch = fetch,
) {
  if (
    !env.KOMISIO_AUTH_SMS_HOOK_SECRET ||
    !verifyAuthWebhookSignature(raw, headers, env.KOMISIO_AUTH_SMS_HOOK_SECRET)
  )
    return 401
  const username = env.ELKS_API_USERNAME ?? ''
  const password = env.ELKS_API_PASSWORD ?? ''
  if (!/^[A-Za-z0-9_-]+$/.test(username) || !/^[\x21-\x7e]+$/.test(password))
    return 503

  try {
    const payload: unknown = JSON.parse(raw)
    // Deployment probe validates signing/configuration without sending a code.
    if (probeSchema.safeParse(payload).success) return 200
    const { user, sms } = eventSchema.parse(payload)
    const phone = user.phone.startsWith('+') ? user.phone : `+${user.phone}`
    const response = await request('https://api.46elks.com/a1/sms', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        from: 'Komisio',
        to: phone,
        message: `Din verifieringskod för Komisio är ${sms.otp}. Dela inte koden med någon.`,
        dontlog: 'message',
      }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(3000),
    })
    // Do not trigger Auth's 5xx retries after an uncertain provider outcome.
    // The user can explicitly request another code through Auth's normal limits.
    if (!response.ok) return 400
    const accepted = acceptedSchema.safeParse(await response.json())
    return accepted.success && accepted.data.to === phone ? 200 : 400
  } catch {
    // Never include provider bodies, credentials, phone numbers or codes in logs.
    return 400
  }
}
