import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  storeMailCommand,
  unsubscribeCommand,
} from '../../lib/engine/store-mail'
import {
  sendStoreEmail,
  retryAfterSeconds,
} from '../../lib/platform/store-email'
import { processStoreMail } from '../../lib/communications/store-mail'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { dictionary, locales } from '../../lib/i18n'
const id = 'ef770000-0000-4000-8000-000000000001'
const input = {
  messageId: id,
  to: 'seller@example.test',
  subject: 'Hours',
  text: 'Hello',
  senderName: 'Synthetic store',
  replyTo: 'store@example.test',
}
const env = {
  SELLER_EMAIL_DELIVERY: 'resend',
  SELLER_EMAIL_ALLOWLIST: '*',
  SELLER_EMAIL_FROM: 'Komisio <mail@example.test>',
  RESEND_API_KEY: 'synthetic',
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('store email boundaries', () => {
  it.each(locales)(
    'adds a private recipient link and localized footer in %s',
    async (locale) => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: 'synthetic' })))
      vi.stubGlobal('fetch', fetcher)
      const rpc = vi
        .fn()
        .mockResolvedValueOnce({
          data: { ...input, body: 'Content', locale },
          error: null,
        })
        .mockResolvedValueOnce({ data: id, error: null })
        .mockResolvedValueOnce({ data: [], error: null })
      const result = await processStoreMail(
        { rpc } as unknown as SupabaseClient,
        id,
        id,
        'https://app.example.test',
      )
      const text = JSON.parse(fetcher.mock.calls[0][1].body).text as string
      expect(text).toContain(dictionary(locale).storeMail.footer)
      const link = new URL(text.split('\n').at(-1)!)
      expect(link.pathname).toBe('/unsubscribe')
      expect(link.searchParams.get('lang')).toBe(locale)
      const token = link.hash.split('.')[1]
      expect(token).toMatch(/^[a-f0-9]{64}$/)
      expect(rpc.mock.calls[0][1].p_unsubscribe_hash).toBe(
        createHash('sha256').update(token).digest('hex'),
      )
      expect(JSON.stringify(result)).not.toContain(token)
    },
  )
  it('accepts zero hidden recipient or consent fields from staff', () => {
    const c = {
      action: 'create',
      tenantId: id,
      requestId: id,
      subject: 'Hello',
      body: 'Message',
      revision: 'a'.repeat(64),
    }
    expect(storeMailCommand.safeParse(c).success).toBe(true)
    expect(
      storeMailCommand.safeParse({ ...c, recipients: ['other@example.test'] })
        .success,
    ).toBe(false)
    expect(
      storeMailCommand.safeParse({ ...c, subject: 'Title\r\nBcc: victim' })
        .success,
    ).toBe(false)
    expect(
      unsubscribeCommand.safeParse({ messageId: id, token: 'a'.repeat(64) })
        .success,
    ).toBe(true)
    expect(
      unsubscribeCommand.safeParse({ messageId: id, token: 'short' }).success,
    ).toBe(false)
  })
  it('sends one address with store identity on the verified domain', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'delivery' })))
    vi.stubGlobal('fetch', fetcher)
    expect((await sendStoreEmail(input, env)).status).toBe('sent')
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).toEqual({
      from: '"Synthetic store" <mail@example.test>',
      reply_to: input.replyTo,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    })
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toContain(id)
  })
  it('keeps deployment allowlists and manual mode', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(
      (await sendStoreEmail(input, { ...env, SELLER_EMAIL_DELIVERY: 'manual' }))
        .status,
    ).toBe('manual')
    expect(
      (
        await sendStoreEmail(input, {
          ...env,
          SELLER_EMAIL_ALLOWLIST: 'other@example.test',
        })
      ).status,
    ).toBe('restricted')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('honors provider cooldown and never retries an uncertain send', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response('', { status: 429, headers: { 'retry-after': '120' } }),
      )
    vi.stubGlobal('fetch', fetcher)
    expect(await sendStoreEmail(input, env)).toEqual({
      status: 'failed',
      providerMessageId: '',
      cooldown: 120,
    })
    fetcher.mockRejectedValueOnce(new Error('timeout'))
    expect((await sendStoreEmail(input, env)).status).toBe('unconfirmed')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(retryAfterSeconds('bad')).toBe(60)
    expect(retryAfterSeconds('0')).toBe(1)
    expect(retryAfterSeconds(new Date(120000).toUTCString(), 0)).toBe(120)
  })
  it('cannot send when a claim is already consumed or rate limited', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { waitMs: 500 }, error: null })
      .mockResolvedValueOnce({ data: { done: true }, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    const client = { rpc } as unknown as SupabaseClient
    expect(
      await processStoreMail(client, id, id, 'https://example.test'),
    ).toEqual({ waitMs: 500 })
    expect(
      await processStoreMail(client, id, id, 'https://example.test'),
    ).toEqual({ done: true, history: [] })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
