import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { dictionary, isLocale, type Locale } from '../i18n'
import { authEmailCopy, authEmailLocale } from './auth-email-copy'

type Env = Record<string, string | undefined>
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )
const hash = z.string().regex(/^(?:pkce_)?[a-f0-9]{56,64}$/)
const eventSchema = z.object({
  user: z.object({
    email: z.email(),
    new_email: z.string().nullish(),
    user_metadata: z.record(z.string(), z.unknown()).nullish(),
  }),
  email_data: z.object({
    email_action_type: z.string(),
    token_hash: z.string().optional(),
    token_hash_new: z.string().optional(),
    token: z.string().optional(),
    token_new: z.string().optional(),
    old_email: z.string().optional(),
    redirect_to: z.string().default(''),
  }),
})
const snapshotSchema = z.object({
  id: z.uuid(),
  locale: z.string().refine(isLocale),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
})
type Mail = { to: string; subject: string; text: string; html: string }

/** Standard Webhooks v1: authenticate raw bytes before parsing or using tokens. */
export function verifyAuthEmailSignature(
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

function render(
  to: string,
  subject: string,
  body: string,
  button?: { label: string; url: string },
): Mail {
  const paragraphs = body.split('\n\n')
  const html = paragraphs
    .map((p) =>
      button && p === button.label
        ? `<p><a href="${escape(button.url)}" style="display:inline-block;background:#163f35;color:#fff;padding:14px 22px;border-radius:8px;text-decoration:none">${escape(button.label)}</a></p>`
        : `<p style="line-height:1.6">${escape(p).replaceAll('\n', '<br>')}</p>`,
    )
    .join('')
  return {
    to,
    subject,
    text: paragraphs
      .map((p) => (button && p === button.label ? `${p}\n${button.url}` : p))
      .join('\n\n'),
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;color:#163f35;padding:24px;max-width:560px;margin:auto"><h1>${escape(subject)}</h1>${html}</body></html>`,
  }
}

/** Authenticated hook only. No service-role key or staff browser session. */
export async function handleAuthEmail(
  raw: string,
  headers: Headers,
  env: Env = process.env,
  request: typeof fetch = fetch,
) {
  if (
    !env.KOMISIO_AUTH_EMAIL_HOOK_SECRET ||
    !verifyAuthEmailSignature(raw, headers, env.KOMISIO_AUTH_EMAIL_HOOK_SECRET)
  )
    return 401
  try {
    if (
      !env.RESEND_API_KEY ||
      !(env.SELLER_EMAIL_FROM || env.INVITATION_EMAIL_FROM) ||
      !env.NEXT_PUBLIC_APP_URL ||
      !env.NEXT_PUBLIC_SUPABASE_URL ||
      !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    )
      return 503
    const payload: unknown = JSON.parse(raw)
    // Protected deployment probes prove that the configured signing key and
    // transport are present before Auth is pointed at this handler. No email.
    if (
      z
        .object({ type: z.literal('komisio-auth-email-probe') })
        .strict()
        .safeParse(payload).success
    )
      return 200
    const { user, email_data: e } = eventSchema.parse(payload)
    const origin = new URL(env.NEXT_PUBLIC_APP_URL).origin
    let locale: Locale = authEmailLocale(user.user_metadata)
    const destination = new URL(e.redirect_to || origin)
    const activation =
      destination.origin === origin && destination.pathname === '/auth/activate'
    const ticket = destination.searchParams.get('ticket')
    const mails: Mail[] = []
    if (activation && ticket) {
      if (
        !['signup', 'magiclink'].includes(e.email_action_type) ||
        !/^[a-f0-9]{64}$/.test(ticket)
      )
        return 400
      // Validate the hash before consuming the capability. It is never persisted.
      const token = hash.parse(e.token_hash)
      const response = await request(
        new URL(
          '/rest/v1/rpc/consume_seller_activation_email',
          env.NEXT_PUBLIC_SUPABASE_URL,
        ),
        {
          method: 'POST',
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ p_ticket: ticket, p_recipient: user.email }),
          redirect: 'error',
          signal: AbortSignal.timeout(3000),
        },
      )
      if (!response.ok) return 503
      const frozen = snapshotSchema.safeParse(await response.json())
      if (!frozen.success) return 503
      locale = frozen.data.locale as Locale
      const label = dictionary(locale).sellerActivation.confirm
      if (
        frozen.data.body.split('\n\n').filter((p) => p === label).length !== 1
      )
        return 400
      const url = new URL('/auth/activate', origin)
      url.searchParams.set('token_hash', token)
      url.searchParams.set('locale', locale)
      mails.push(
        render(user.email, frozen.data.subject, frozen.data.body, {
          label,
          url: url.href,
        }),
      )
    } else {
      const selected = authEmailCopy(
        locale,
        activation && e.email_action_type === 'signup'
          ? 'magiclink'
          : e.email_action_type,
      )
      if (!selected) return 400
      locale = selected.locale
      const copy = selected.copy
      const verify = (
        token: string | undefined,
        type = e.email_action_type,
      ) => {
        const url = new URL('/auth/v1/verify', env.NEXT_PUBLIC_SUPABASE_URL)
        url.searchParams.set('token', hash.parse(token))
        url.searchParams.set('type', type)
        // Auth has already validated this redirect against its allowlist.
        url.searchParams.set('redirect_to', e.redirect_to || origin)
        return url.href
      }
      if (
        (activation && e.email_action_type === 'signup') ||
        e.email_action_type === 'magiclink'
      ) {
        const url = new URL('/auth/activate', origin)
        url.searchParams.set('token_hash', hash.parse(e.token_hash))
        url.searchParams.set('locale', locale)
        mails.push(
          render(
            user.email,
            copy.subject,
            `${copy.intro}\n\n${copy.button}\n\n${copy.note}`,
            { label: copy.button, url: url.href },
          ),
        )
      } else if (e.email_action_type === 'signup') {
        mails.push(
          render(
            user.email,
            copy.subject,
            `${copy.intro}\n\n${copy.button}\n\n${copy.note}`,
            { label: copy.button, url: verify(e.token_hash) },
          ),
        )
      } else if (
        e.email_action_type === 'recovery' ||
        e.email_action_type === 'invite'
      ) {
        mails.push(
          render(
            user.email,
            copy.subject,
            `${copy.intro}\n\n${copy.button}\n\n${copy.note}`,
            { label: copy.button, url: verify(e.token_hash) },
          ),
        )
      } else if (e.email_action_type === 'email_change') {
        const newEmail = z.email().parse(user.new_email)
        const label = copy.button
        const body = `${copy.intro}\n\n${label}\n\n${copy.note}`
        // Supabase's hash_new belongs to the CURRENT address (documented API).
        if (e.token_hash_new)
          mails.push(
            render(user.email, copy.subject, body, {
              label,
              url: verify(e.token_hash_new),
            }),
          )
        mails.push(
          render(newEmail, copy.subject, body, {
            label,
            url: verify(e.token_hash),
          }),
        )
      } else if (e.email_action_type === 'reauthentication') {
        const token = z
          .string()
          .regex(/^\d{6,10}$/)
          .parse(e.token)
        mails.push(
          render(
            user.email,
            copy.subject,
            `${copy.intro}\n\n${token}\n\n${copy.note}`,
          ),
        )
      } else {
        // After an email change, Auth's user.email is already the new address.
        // Preserve the security notification to the previous account owner.
        const recipient =
          e.email_action_type === 'email_changed_notification'
            ? z.email().parse(e.old_email)
            : user.email
        mails.push(
          render(recipient, copy.subject, `${copy.subject}.\n\n${copy.note}`),
        )
      }
    }
    for (let i = 0; i < mails.length; i++) {
      const mail = mails[i]
      const response = await request('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `komisio-auth/${headers.get('webhook-id')}/${i}`,
        },
        body: JSON.stringify({
          from: env.SELLER_EMAIL_FROM || env.INVITATION_EMAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) return response.status >= 500 ? 503 : 400
      if (
        !z.object({ id: z.string().min(1) }).safeParse(await response.json())
          .success
      )
        return 503
    }
    return 200
  } catch (error) {
    // A consumed activation capability is never retried, including lost replies.
    // No tokens, recipient details or provider response bodies enter logs.
    return error instanceof z.ZodError || error instanceof SyntaxError
      ? 400
      : 503
  }
}
