import { allowsRecipient } from './email-allowlist'
import { emailTemplate } from '../communications/locale'
import { plainText } from '../communications/templates'

export function renderInvitationEmail(locale: string, inviteUrl: string) {
  const resolved = emailTemplate(locale, (d) => d.communications.invitation)
  return {
    locale: resolved.locale,
    subject: plainText(resolved.copy.subject.slice(0, 200)),
    text: resolved.copy.body.replace(/\{url\}/g, () =>
      plainText(inviteUrl).replace(/\n/g, ''),
    ),
  }
}

export type InvitationDelivery =
  'accepted' | 'manual' | 'restricted' | 'unconfirmed'

// Server-only caller: this module is imported by the authenticated route handler.
// Delivery follows the deployment's allowlist (`*` for an open deployment); the
// engine has already checked who may invite, and caps how many per day.
export async function sendInvitationEmail(input: {
  invitationId: string
  email: string
  inviteUrl: string
  locale: string
}): Promise<InvitationDelivery> {
  if (process.env.INVITATION_EMAIL_DELIVERY !== 'resend') return 'manual'
  if (!allowsRecipient(process.env.INVITATION_EMAIL_ALLOWLIST, input.email))
    return 'restricted'
  const key = process.env.RESEND_API_KEY
  const from = process.env.INVITATION_EMAIL_FROM
  if (!key || !from) return 'unconfirmed'
  const { subject, text } = renderInvitationEmail(input.locale, input.inviteUrl)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `komisio-invitation/${input.invitationId}`,
      },
      body: JSON.stringify({
        from,
        to: [input.email.trim().toLowerCase()],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    if (!response.ok) return 'unconfirmed'
    const result = await response.json()
    return typeof result.id === 'string' && result.id
      ? 'accepted'
      : 'unconfirmed'
  } catch {
    // Timeout may occur after provider acceptance; do not claim non-delivery.
    // Never log provider responses, recipient addresses or invitation tokens.
    return 'unconfirmed'
  }
}
