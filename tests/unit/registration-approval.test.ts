import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { locales } from '../../lib/i18n'
import {
  renderRegistrationApproval,
  notifyRegistrationApproval,
} from '../../lib/communications/registration-approval'
const id = 'f4270000-0000-4000-8000-000000000001'
const facts = {
  tenantId: id,
  reviewId: id,
  sellerId: id,
  recipient: 'synthetic@example.test',
  locale: 'dk',
  storeName: 'Synthetic store',
  sellerName: 'Synthetic seller',
}
const env = { NEXT_PUBLIC_APP_URL: 'https://app.example.test' }
function fixture(
  mode: 'ok' | 'lost' | 'stale' | 'wrong' = 'ok',
  finishError = false,
) {
  let claimed = false
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'registration_approval_notice')
      return { data: claimed ? null : facts, error: null }
    if (name === 'claim_registration_approval_notice') {
      claimed = true
      return {
        data: mode === 'ok' ? args!.p_id : mode === 'wrong' ? id : null,
        error: mode === 'lost' ? { message: 'lost' } : null,
      }
    }
    if (name === 'record_communication_delivery')
      return { data: args!.p_id, error: finishError ? {} : null }
    throw new Error(name)
  })
  return { rpc, client: { rpc } as unknown as SupabaseClient }
}
it.each(locales)(
  'renders a complete approval in %s with a safe portal login link',
  (locale) => {
    const m = renderRegistrationApproval(
      locale,
      'Store $&\nName',
      'Seller $&\nName',
      'https://app.example.test/ignored',
    )
    expect(m.locale).toBe(locale)
    expect(m.subject).toContain('Store $& Name')
    expect(m.subject).not.toMatch(/[\r\n]/)
    expect(m.body).toContain('Seller $& Name')
    expect(m.body).not.toMatch(/\{(store|seller|url)\}/)
    const url = new URL(m.body.match(/https:\/\/[^\s]+/)![0])
    expect(url.origin).toBe('https://app.example.test')
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/seller')
    expect(url.searchParams.get('locale')).toBe(locale)
    expect(m.body).not.toContain('synthetic@example.test')
  },
)
it('makes one provider attempt and retains the same exact subject/body in history', async () => {
  const f = fixture(),
    send = vi
      .fn()
      .mockResolvedValue({ status: 'sent', providerMessageId: 'synthetic' })
  expect(await notifyRegistrationApproval(f.client, id, id, env, send)).toEqual(
    { attempted: true, delivery: 'sent' },
  )
  expect(await notifyRegistrationApproval(f.client, id, id, env, send)).toEqual(
    { attempted: false },
  )
  const claim = f.rpc.mock.calls.find(
    ([name]) => name === 'claim_registration_approval_notice',
  )![1]!
  expect(send).toHaveBeenCalledExactlyOnceWith(
    {
      communicationId: claim.p_id,
      to: facts.recipient,
      subject: claim.p_subject,
      text: claim.p_body,
    },
    env,
  )
  expect(claim.p_locale).toBe('dk')
})
it.each(['lost', 'stale', 'wrong'] as const)(
  'never sends after a %s claim',
  async (mode) => {
    const f = fixture(mode),
      send = vi.fn()
    const attempt = notifyRegistrationApproval(f.client, id, id, env, send)
    if (mode === 'stale') expect(await attempt).toEqual({ attempted: false })
    else await expect(attempt).rejects.toThrow(/REGISTRATION_NOTICE_CLAIM/)
    expect(send).not.toHaveBeenCalled()
    expect(
      await notifyRegistrationApproval(f.client, id, id, env, send),
    ).toEqual({ attempted: false })
  },
)
it('records a thrown provider request as unconfirmed and never repeats it', async () => {
  const f = fixture(),
    send = vi.fn().mockRejectedValue(new Error('unknown'))
  expect(await notifyRegistrationApproval(f.client, id, id, env, send)).toEqual(
    { attempted: true, delivery: 'unconfirmed' },
  )
  expect(f.rpc).toHaveBeenLastCalledWith(
    'record_communication_delivery',
    expect.objectContaining({
      p_status: 'unconfirmed',
      p_provider_message_id: '',
    }),
  )
  await notifyRegistrationApproval(f.client, id, id, env, send)
  expect(send).toHaveBeenCalledTimes(1)
})
it('a failed outcome write never creates a second delivery attempt', async () => {
  const f = fixture('ok', true),
    send = vi
      .fn()
      .mockResolvedValue({ status: 'sent', providerMessageId: 'synthetic' })
  await expect(
    notifyRegistrationApproval(f.client, id, id, env, send),
  ).rejects.toThrow('REGISTRATION_NOTICE_FINISH_FAILED')
  expect(await notifyRegistrationApproval(f.client, id, id, env, send)).toEqual(
    { attempted: false },
  )
  expect(send).toHaveBeenCalledTimes(1)
})
it('does not deliver rejected, already claimed or unavailable approvals', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null }),
    send = vi.fn()
  expect(
    await notifyRegistrationApproval(
      { rpc } as unknown as SupabaseClient,
      id,
      id,
      env,
      send,
    ),
  ).toEqual({ attempted: false })
  expect(send).not.toHaveBeenCalled()
  expect(rpc).toHaveBeenCalledTimes(1)
})
