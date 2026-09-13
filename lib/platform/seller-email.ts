export type SellerEmailDelivery =
  'sent' | 'manual' | 'restricted' | 'unconfirmed' | 'failed'

// Server-only transport for seller messages (P2 S18). Same pilot rules as the
// invitation e-mail: an explicit transport switch, exact allowlisted mailboxes
// (never a wildcard or a domain), and no logging of addresses or bodies.
export async function sendSellerEmail(
  input: { communicationId: string; to: string; subject: string; text: string },
  env: Record<string, string | undefined> = process.env,
): Promise<SellerEmailDelivery> {
  const delivery =
    env.SELLER_EMAIL_DELIVERY ?? env.INVITATION_EMAIL_DELIVERY ?? 'manual'
  if (delivery !== 'resend') return 'manual'
  const allowed = (
    env.SELLER_EMAIL_ALLOWLIST ??
    env.INVITATION_EMAIL_ALLOWLIST ??
    ''
  )
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  const to = input.to.trim().toLowerCase()
  if (!allowed.includes(to)) return 'restricted'
  const key = env.RESEND_API_KEY,
    from = env.SELLER_EMAIL_FROM ?? env.INVITATION_EMAIL_FROM
  if (!key || !from) return 'unconfirmed'
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `komisio-communication/${input.communicationId}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    if (!response.ok) return response.status >= 500 ? 'unconfirmed' : 'failed'
    const result = await response.json()
    return typeof result.id === 'string' && result.id ? 'sent' : 'unconfirmed'
  } catch {
    // A timeout may follow provider acceptance; never claim non-delivery.
    return 'unconfirmed'
  }
}

/** The provider message id when the send was accepted, for the log. */
export async function sendSellerEmailWithId(
  input: { communicationId: string; to: string; subject: string; text: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ status: SellerEmailDelivery; providerMessageId: string }> {
  const delivery =
    env.SELLER_EMAIL_DELIVERY ?? env.INVITATION_EMAIL_DELIVERY ?? 'manual'
  if (delivery !== 'resend')
    return { status: await sendSellerEmail(input, env), providerMessageId: '' }
  const allowed = (
    env.SELLER_EMAIL_ALLOWLIST ??
    env.INVITATION_EMAIL_ALLOWLIST ??
    ''
  )
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  const to = input.to.trim().toLowerCase()
  if (!allowed.includes(to))
    return { status: 'restricted', providerMessageId: '' }
  const key = env.RESEND_API_KEY,
    from = env.SELLER_EMAIL_FROM ?? env.INVITATION_EMAIL_FROM
  if (!key || !from) return { status: 'unconfirmed', providerMessageId: '' }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `komisio-communication/${input.communicationId}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    if (!response.ok)
      return {
        status: response.status >= 500 ? 'unconfirmed' : 'failed',
        providerMessageId: '',
      }
    const result = await response.json()
    return typeof result.id === 'string' && result.id
      ? { status: 'sent', providerMessageId: result.id.slice(0, 200) }
      : { status: 'unconfirmed', providerMessageId: '' }
  } catch {
    return { status: 'unconfirmed', providerMessageId: '' }
  }
}
