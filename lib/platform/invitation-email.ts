import { allowsRecipient } from './email-allowlist'

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
  const swedish = input.locale === 'sv'
  // Plain text and fixed wording prevent store-name HTML/link injection.
  const text = swedish
    ? `Du har blivit inbjuden till en butik i Komisio.\n\nLogga in eller skapa ett konto med denna e-postadress för att granska och acceptera inbjudan:\n${input.inviteUrl}\n\nLänken gäller i sju dagar. Om du inte väntade dig denna inbjudan kan du ignorera mejlet.`
    : `You have been invited to a store in Komisio.\n\nSign in or create an account with this email address to review and accept the invitation:\n${input.inviteUrl}\n\nThe link expires in seven days. If you did not expect this invitation, you can ignore this email.`
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
        subject: swedish ? 'Inbjudan till Komisio' : 'Invitation to Komisio',
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
