import type { Locale } from '../i18n'
import { allowsRecipient } from './email-allowlist'
import type { SellerEmailDelivery } from './seller-email'

/** Public Auth API only; no staff session, administrative key or generated password. */
export async function sendSellerActivation(
  email: string,
  locale: Locale,
  ticket?: string,
  env: Record<string, string | undefined> = process.env,
  request: typeof fetch = fetch,
): Promise<{ status: SellerEmailDelivery; providerMessageId: string }> {
  const result = (status: SellerEmailDelivery) => ({
    status,
    providerMessageId: status === 'sent' ? 'supabase-auth' : '',
  })
  const delivery =
    env.SELLER_ACCOUNT_DELIVERY ||
    env.SELLER_EMAIL_DELIVERY ||
    env.INVITATION_EMAIL_DELIVERY ||
    'manual'
  if (!['auth', 'resend'].includes(delivery)) return result('manual')
  if (
    !allowsRecipient(
      env.SELLER_EMAIL_ALLOWLIST ?? env.INVITATION_EMAIL_ALLOWLIST,
      email,
    )
  )
    return result('restricted')
  if (
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    !env.NEXT_PUBLIC_APP_URL
  )
    return result('failed')
  if (
    ticket &&
    (!/^[a-f0-9]{64}$/.test(ticket) || !env.KOMISIO_AUTH_EMAIL_HOOK_SECRET)
  )
    return result('failed')
  try {
    const endpoint = new URL('/auth/v1/otp', env.NEXT_PUBLIC_SUPABASE_URL)
    const redirect = new URL('/auth/activate', env.NEXT_PUBLIC_APP_URL)
    if (ticket) redirect.searchParams.set('ticket', ticket)
    endpoint.searchParams.set('redirect_to', redirect.href)
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, create_user: true, data: { locale } }),
      // No PKCE verifier belongs to the staff browser. The recipient verifies
      // the one-time email hash from their own browser in /auth/activate.
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    return result(
      response.ok ? 'sent' : response.status >= 500 ? 'unconfirmed' : 'failed',
    )
  } catch {
    return result('unconfirmed')
  }
}
