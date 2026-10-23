import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { handleAuthEmail } from '../../lib/platform/auth-email'
import { renderSellerWelcome } from '../../lib/communications/welcome'
import { dictionary, locales } from '../../lib/i18n'
const key = Buffer.alloc(32, 9)
const env = {
  KOMISIO_AUTH_EMAIL_HOOK_SECRET: `v1,whsec_${key.toString('base64')}`,
  RESEND_API_KEY: 'synthetic',
  SELLER_EMAIL_FROM: 'noreply@example.test',
  NEXT_PUBLIC_APP_URL: 'https://app.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://auth.example.test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
}
const ticket = 'ab'.repeat(32)
const token = 'cd'.repeat(28)
function signed(
  action = 'magiclink',
  redirect = `https://app.example.test/auth/activate?ticket=${ticket}`,
  extra = {},
  now = Date.now(),
) {
  const raw = JSON.stringify({
    user: {
      email: 'seller@example.test',
      new_email: 'new@example.test',
      user_metadata: { locale: 'en' },
    },
    email_data: {
      email_action_type: action,
      redirect_to: redirect,
      token_hash: token,
      ...extra,
    },
  })
  const timestamp = Math.floor(now / 1000).toString()
  const signature = createHmac('sha256', key)
    .update(`synthetic-event.${timestamp}.${raw}`)
    .digest('base64')
  return {
    raw,
    headers: new Headers({
      'webhook-id': 'synthetic-event',
      'webhook-timestamp': timestamp,
      'webhook-signature': `v1,${signature}`,
    }),
  }
}
it('sends the frozen personalized copy and language for new and existing accounts in all languages', async () => {
  for (const locale of locales)
    for (const action of ['signup', 'magiclink']) {
      const frozen = renderSellerWelcome(
        locale,
        'Synthetic <Store> & Co',
        'Synthetic Seller',
        env.NEXT_PUBLIC_APP_URL,
      )
      const request = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            id: 'a0000000-0000-4000-8000-000000000001',
            locale,
            subject: frozen.subject,
            body: frozen.body,
          }),
        )
        .mockResolvedValueOnce(Response.json({ id: 'provider-id' }))
      const { raw, headers } = signed(action)
      expect(await handleAuthEmail(raw, headers, env, request)).toBe(200)
      expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
        p_ticket: ticket,
        p_recipient: 'seller@example.test',
      })
      const mail = JSON.parse(request.mock.calls[1][1].body)
      expect(mail.subject).toBe(frozen.subject)
      const link = `https://app.example.test/auth/activate?token_hash=${token}&locale=${locale}`
      expect(mail.text.replace(`\n${link}`, '')).toBe(frozen.body)
      expect(mail.html).toContain('Synthetic &lt;Store&gt; &amp; Co')
      expect(mail.html).not.toContain('<Store>')
      expect(mail.html).toContain('Synthetic Seller')
      expect(mail.html).toContain(dictionary(locale).sellerActivation.confirm)
      expect(mail.text).not.toContain(ticket)
      expect(frozen.body).not.toContain(token)
      expect(request.mock.calls[0][1].headers).not.toHaveProperty(
        'Authorization',
      )
    }
})
it('rejects tampering, stale signatures and missing configuration before any delivery', async () => {
  const valid = signed()
  const stale = signed('signup', undefined, {}, Date.now() - 360000)
  for (const [raw, headers, config] of [
    [valid.raw + ' ', valid.headers, env],
    [stale.raw, stale.headers, env],
    [valid.raw, new Headers(), env],
    [valid.raw, valid.headers, { ...env, KOMISIO_AUTH_EMAIL_HOOK_SECRET: '' }],
  ] as const) {
    const request = vi.fn()
    expect(await handleAuthEmail(raw, headers, config, request)).toBe(401)
    expect(request).not.toHaveBeenCalled()
  }
})
it('rejects consumed, expired or mismatched capabilities without sending a generic substitute', async () => {
  const { raw, headers } = signed()
  const request = vi.fn().mockResolvedValueOnce(Response.json(null))
  expect(await handleAuthEmail(raw, headers, env, request)).toBe(503)
  expect(request).toHaveBeenCalledTimes(1)
})
it('rejects malformed hashes before consuming and does not resend after an uncertain provider result', async () => {
  const bad = signed('magiclink', undefined, { token_hash: 'bad' })
  const request = vi.fn()
  expect(await handleAuthEmail(bad.raw, bad.headers, env, request)).toBe(400)
  expect(request).not.toHaveBeenCalled()
  const frozen = renderSellerWelcome(
    'sv',
    'Store',
    'Seller',
    env.NEXT_PUBLIC_APP_URL,
  )
  request
    .mockResolvedValueOnce(
      Response.json({
        id: 'a0000000-0000-4000-8000-000000000001',
        ...frozen,
      }),
    )
    .mockRejectedValueOnce(new Error('timeout'))
  const good = signed()
  expect(await handleAuthEmail(good.raw, good.headers, env, request)).toBe(503)
  expect(request).toHaveBeenCalledTimes(2)
})
it('preserves confirmation, recovery and secure email-change verification paths', async () => {
  for (const action of ['signup', 'recovery', 'invite', 'email_change']) {
    const request = vi
      .fn()
      .mockImplementation(async () => Response.json({ id: 'sent' }))
    const { raw, headers } = signed(
      action,
      'https://app.example.test/auth/callback?next=/account',
      action === 'email_change' ? { token_hash_new: 'ef'.repeat(28) } : {},
    )
    expect(await handleAuthEmail(raw, headers, env, request)).toBe(200)
    const mails = request.mock.calls.map(([, options]) =>
      JSON.parse(options.body),
    )
    expect(mails).toHaveLength(action === 'email_change' ? 2 : 1)
    for (const mail of mails) expect(mail.html).toContain(`type=${action}`)
    if (action === 'email_change') {
      expect(mails[0].to).toEqual(['seller@example.test'])
      expect(mails[0].html).toContain('ef'.repeat(28))
      expect(mails[1].to).toEqual(['new@example.test'])
      expect(mails[1].html).toContain(token)
    }
  }
})
it('handles verification codes and account-security notices without silently accepting unknown actions', async () => {
  for (const action of [
    'reauthentication',
    'password_changed_notification',
    'email_changed_notification',
    'phone_changed_notification',
    'identity_linked_notification',
    'identity_unlinked_notification',
    'mfa_factor_enrolled_notification',
    'mfa_factor_unenrolled_notification',
    'unknown',
  ]) {
    const request = vi.fn().mockResolvedValue(Response.json({ id: 'sent' }))
    const { raw, headers } = signed(action, 'https://app.example.test', {
      token: '12345678',
      old_email: 'previous@example.test',
    })
    expect(await handleAuthEmail(raw, headers, env, request)).toBe(
      action === 'unknown' ? 400 : 200,
    )
    expect(request).toHaveBeenCalledTimes(action === 'unknown' ? 0 : 1)
    if (action === 'email_changed_notification')
      expect(JSON.parse(request.mock.calls[0][1].body).to).toEqual([
        'previous@example.test',
      ])
  }
})
it('does not send an email-change warning to the new address when the old address is missing or invalid', async () => {
  for (const old_email of [undefined, '', 'invalid']) {
    const { raw, headers } = signed(
      'email_changed_notification',
      'https://app.example.test',
      { old_email },
    )
    const request = vi.fn()
    expect(await handleAuthEmail(raw, headers, env, request)).toBe(400)
    expect(request).not.toHaveBeenCalled()
  }
})
