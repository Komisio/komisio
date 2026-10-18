import { allowsRecipient } from './email-allowlist'
import type { SellerEmailDelivery } from './seller-email'

export type StoreDelivery = {
  status: SellerEmailDelivery
  providerMessageId: string
  cooldown: number
}
export function retryAfterSeconds(value: string | null, now = Date.now()) {
  const seconds =
    value && /^\d+$/.test(value)
      ? Number(value)
      : value
        ? (Date.parse(value) - now) / 1000
        : 60
  return Math.min(
    86400,
    Math.max(1, Math.ceil(Number.isFinite(seconds) ? seconds : 60)),
  )
}
export async function sendStoreEmail(
  input: {
    messageId: string
    to: string
    subject: string
    text: string
    senderName: string
    replyTo: string
  },
  env: Record<string, string | undefined> = process.env,
): Promise<StoreDelivery> {
  const result = (
    status: SellerEmailDelivery,
    cooldown = 0,
  ): StoreDelivery => ({ status, providerMessageId: '', cooldown })
  if ((env.SELLER_EMAIL_DELIVERY ?? env.INVITATION_EMAIL_DELIVERY) !== 'resend')
    return result('manual')
  if (
    !allowsRecipient(
      env.SELLER_EMAIL_ALLOWLIST ?? env.INVITATION_EMAIL_ALLOWLIST,
      input.to,
    )
  )
    return result('restricted')
  const configured = env.SELLER_EMAIL_FROM ?? env.INVITATION_EMAIL_FROM ?? ''
  const fromAddress = configured.match(/<([^<>]+)>$/)?.[1] ?? configured
  if (
    !env.RESEND_API_KEY ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(fromAddress) ||
    /[\r\n]/.test(input.replyTo)
  )
    return result('unconfirmed')
  // Display name belongs to the store; the sending address stays on the host's verified domain.
  const name = input.senderName.replace(/[\r\n<>"\\]/g, '').slice(0, 120)
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `komisio-communication/${input.messageId}`,
      },
      body: JSON.stringify({
        from: `"${name}" <${fromAddress}>`,
        reply_to: input.replyTo,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    })
    if (r.status === 429)
      return result('failed', retryAfterSeconds(r.headers.get('retry-after')))
    if (!r.ok) return result(r.status >= 500 ? 'unconfirmed' : 'failed')
    const data = await r.json()
    return typeof data.id === 'string' && data.id
      ? {
          status: 'sent',
          providerMessageId: data.id.slice(0, 200),
          cooldown: 0,
        }
      : result('unconfirmed')
  } catch {
    return result('unconfirmed')
  }
}
