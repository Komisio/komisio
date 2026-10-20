import { createHmac } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { handleAuthEmail } from '../../lib/platform/auth-email'
import {
  authEmailActions,
  authEmailLocale,
} from '../../lib/platform/auth-email-copy'
import { dictionary, locales } from '../../lib/i18n'
import confirmationCopy from '../../lib/platform/confirmation-copy.json'

const key = Buffer.alloc(32, 9)
const env = {
  KOMISIO_AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${key.toString('base64')}`,
  RESEND_API_KEY: 'synthetic',
  SELLER_EMAIL_FROM: 'noreply@example.test',
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
}
const token = 'cd'.repeat(28)
const currentToken = 'ef'.repeat(28)
const redirect = 'https://app.example.test/auth/callback?next=/account'
type Mail = { to: string[]; subject: string; text: string; html: string }

function signed(action: string, metadata: unknown) {
  const raw = JSON.stringify({
    user: {
      email: 'synthetic@example.test',
      new_email: 'new@example.test',
      user_metadata: metadata,
    },
    email_data: {
      email_action_type: action,
      redirect_to: redirect,
      token_hash: token,
      token_hash_new: currentToken,
      token: '12345678',
      old_email: 'old@example.test',
    },
  })
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return {
    raw,
    headers: new Headers({
      'webhook-id': 'locale-test',
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${createHmac('sha256', key).update(`locale-test.${timestamp}.${raw}`).digest('base64')}`,
    }),
  }
}
async function deliver(action: string, metadata: unknown) {
  const mails: Mail[] = []
  const request = vi.fn<typeof fetch>(async (url, options) => {
    expect(url).toBe('https://api.resend.com/emails')
    expect(new Headers(options?.headers).get('Idempotency-Key')).toBe(
      `komisio-auth/locale-test/${mails.length}`,
    )
    mails.push(JSON.parse(String(options?.body)))
    return Response.json({ id: 'synthetic-sent' })
  })
  const { raw, headers } = signed(action, metadata)
  expect(await handleAuthEmail(raw, headers, env, request)).toBe(200)
  return mails
}
afterEach(() => vi.restoreAllMocks())

it.each(locales)(
  'ships complete auth copy and preserves hosted signup/magic-link copy in %s',
  (locale) => {
    const all = dictionary(locale).authEmail
    expect(Object.keys(all).sort()).toEqual([...authEmailActions].sort())
    for (const action of authEmailActions) {
      const source = dictionary('en').authEmail[action]
      expect(Object.keys(all[action]).sort()).toEqual(
        Object.keys(source).sort(),
      )
      for (const value of Object.values(all[action])) {
        expect(value.trim().length).toBeGreaterThan(0)
        expect(value).not.toMatch(/\{[^}]*\}/)
      }
      if (locale !== 'en') expect(all[action].subject).not.toBe(source.subject)
    }
    const [title, intro, button, note] = confirmationCopy[locale]
    expect(all.signup).toEqual({
      subject: `Komisio – ${title}`,
      intro,
      button,
      note,
    })
    const activation = dictionary(locale).sellerActivation
    expect(all.magiclink).toEqual({
      subject: `Komisio – ${activation.title}`,
      intro: activation.intro,
      button: activation.confirm,
      note: activation.emailNote,
    })
  },
)

it.each(locales)(
  'renders every auth action in %s with intact recipients, codes, buttons and links',
  async (locale) => {
    for (const action of authEmailActions) {
      const copy = dictionary(locale).authEmail[action]
      const mails = await deliver(action, { locale })
      expect(mails).toHaveLength(action === 'email_change' ? 2 : 1)
      for (const [i, mail] of mails.entries()) {
        expect(mail.subject).toBe(copy.subject)
        expect(mail.text).toContain(copy.note)
        expect(mail.text).not.toMatch(/\{[^}]*\}|undefined/)
        expect(mail.html).not.toMatch(/\{[^}]*\}|undefined/)
        expect(mail.to).toEqual([
          action === 'email_changed_notification'
            ? 'old@example.test'
            : action === 'email_change' && i === 1
              ? 'new@example.test'
              : 'synthetic@example.test',
        ])
        if ('button' in copy) {
          const paragraphs = mail.text.split('\n\n')
          expect(
            paragraphs.filter((p) => p.startsWith(`${copy.button}\n`)),
          ).toHaveLength(1)
          expect(mail.html.match(/<a href=/g)).toHaveLength(1)
          const url = new URL(
            paragraphs
              .find((p) => p.startsWith(`${copy.button}\n`))!
              .split('\n')[1],
          )
          if (action === 'magiclink') {
            expect(url.origin + url.pathname).toBe(
              `${env.NEXT_PUBLIC_APP_URL}/auth/activate`,
            )
            expect(url.searchParams.get('locale')).toBe(locale)
            expect(url.searchParams.get('token_hash')).toBe(token)
          } else {
            expect(url.origin + url.pathname).toBe(
              `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify`,
            )
            expect(url.searchParams.get('type')).toBe(action)
            expect(url.searchParams.get('token')).toBe(
              action === 'email_change' && i === 0 ? currentToken : token,
            )
            expect(url.searchParams.get('redirect_to')).toBe(redirect)
          }
        } else expect(mail.html).not.toContain('<a ')
        if (action === 'reauthentication')
          expect(mail.text.split('\n\n')).toContain('12345678')
      }
    }
  },
)

it('uses saved product language before signup language, with English for invalid/missing values', async () => {
  for (const [metadata, expected] of [
    [{ product_locale: 'dk', locale: 'en' }, 'dk'],
    [{ locale: 'dk' }, 'dk'],
    [{ product_locale: 'invalid', locale: 'fi' }, 'fi'],
    [{ locale: 'invalid' }, 'en'],
    [{}, 'en'],
    [undefined, 'en'],
    [null, 'en'],
  ] as const) {
    expect(authEmailLocale(metadata)).toBe(expected)
    for (const action of ['recovery', 'reauthentication'] as const) {
      const [mail] = await deliver(action, metadata)
      expect(mail.subject).toBe(dictionary(expected).authEmail[action].subject)
    }
  }
})

it('falls back to English for the whole message when any translated field is missing, empty or has a wrong placeholder', async () => {
  for (const value of [undefined, '', 'Unresolved {code}']) {
    const template = dictionary('dk').authEmail.recovery
    const previous = template.intro
    try {
      Object.assign(template, { intro: value })
      const [mail] = await deliver('recovery', { locale: 'dk' })
      const en = dictionary('en').authEmail.recovery
      expect(mail.subject).toBe(en.subject)
      expect(mail.text).toContain(en.intro)
      expect(mail.text).toContain(en.button)
      expect(mail.text).toContain(en.note)
      expect(mail.text).not.toContain(template.subject)
    } finally {
      template.intro = previous
    }
  }
})
