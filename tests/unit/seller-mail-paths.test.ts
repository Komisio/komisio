import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  sendSellerCommunication,
  notifyAfterFacts,
} from '../../lib/communications/dispatch'
import { notifySubmissionReview } from '../../lib/communications/submission-notification'
import {
  communicationKind,
  renderSellerMessage,
} from '../../lib/communications/templates'
import { renderSellerWelcome } from '../../lib/communications/welcome'
import { renderSubmissionReply } from '../../lib/communications/submission-reply'
import { defaultStorePolicy } from '../../lib/engine/store-policy'
import { sendSellerEmailWithId } from '../../lib/platform/seller-email'
import { sendSellerActivation } from '../../lib/platform/seller-activation'
import type { Locale } from '../../lib/i18n'

vi.mock('../../lib/platform/seller-email', () => ({
  sendSellerEmailWithId: vi.fn(async () => ({
    status: 'sent',
    providerMessageId: 'synthetic',
  })),
}))
vi.mock('../../lib/platform/seller-activation', () => ({
  sendSellerActivation: vi.fn(async () => ({
    status: 'sent',
    providerMessageId: 'synthetic',
  })),
}))
const id = 'f0000000-0000-4000-8000-000000006111'
const storeName = 'Synthetic Store'
const sellerName = 'Synthetic Seller'
const appUrl = 'https://example.test'
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

function client(language?: Locale) {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', appUrl)
  vi.stubEnv('KOMISIO_AUTH_EMAIL_HOOK_ENABLED', 'true')
  let queued: Record<string, unknown> = {}
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'current_store_profile')
      return {
        data: { id: null, version: 0, profile: null, publishedAt: null },
        error: null,
      }
    if (name === 'current_store_policy')
      return {
        data: {
          id: null,
          version: 0,
          policy: {
            ...defaultStorePolicy(),
            automaticSellerNotifications: true,
            communicationLanguage: language,
            itemLanguage: 'it',
          },
        },
        error: null,
      }
    if (name === 'store_currency') return { data: 'SEK', error: null }
    if (name === 'allow_automatic_seller_email')
      return { data: true, error: null }
    if (name === 'queue_seller_communication') queued = args!
    if (name === 'prepare_seller_activation_email')
      return { data: 'ab'.repeat(32), error: null }
    return { data: id, error: null }
  })
  const value = {
    rpc,
    from(table: string) {
      const data: Record<string, unknown> =
        table === 'sellers'
          ? { name: sellerName, email: 'synthetic@example.test', profile: {} }
          : table === 'payouts'
            ? {
                seller_id: id,
                amount_ore: 12345,
                paid_at: '2026-10-23T12:00:00Z',
              }
            : table === 'settlement_statements'
              ? { seller_id: id, closing_ore: 12345, number: 2 }
              : table === 'sale_lines'
                ? { item_id: id, sale_id: id, seller_credit_ore: 12345 }
                : table === 'sales'
                  ? { occurred_at: '2026-10-23T12:00:00Z' }
                  : table === 'item_prices'
                    ? { price_ore: 12345 }
                    : table === 'seller_submission_reviews'
                      ? { submission_id: id }
                      : { seller_id: id }
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        order() {
          return this
        },
        limit() {
          return this
        },
        maybeSingle: async () => ({
          data: table === 'seller_communications' ? null : data,
          error: null,
        }),
        single: async () => ({
          data:
            table === 'seller_communications'
              ? {
                  status: 'queued',
                  recipient: 'synthetic@example.test',
                  subject: queued.p_subject,
                  body: queued.p_body,
                }
              : data,
          error: null,
        }),
      }
    },
  } as unknown as SupabaseClient
  return { value, rpc, queued: () => queued }
}

it.each([undefined, 'sv', 'dk'] as const)(
  'all direct and automatic seller kinds use saved default %s without a seller language or public profile',
  async (language) => {
    const expected = language ?? 'en'
    for (const kind of communicationKind.options) {
      const f = client(language)
      // An obsolete caller property cannot become a fallback; current callers no longer send it.
      const input = {
        tenantId: id,
        storeName,
        locale: 'it',
        requestId: id,
        sellerId: id,
        kind,
        referenceId: kind === 'message' ? null : id,
        freeText: 'Store-written note',
      }
      expect(await sendSellerCommunication(f.value, input)).toMatchObject({
        ok: true,
        delivery: 'sent',
      })
      expect(f.queued().p_locale).toBe(expected)
      const rendered = renderSellerMessage(kind, expected, {
        storeName,
        sellerName,
        freeText: input.freeText,
        ...(kind === 'message' ? {} : { amount: '123.45', currency: 'SEK' }),
        ...(['item_sold', 'payout_paid', 'payout_approved'].includes(kind)
          ? { date: '2026-10-23T12:00:00Z' }
          : {}),
        ...(kind === 'statement_issued' ? { number: 2 } : {}),
      })
      expect(f.queued().p_subject).toBe(rendered.subject)
      expect(f.queued().p_body).toBe(rendered.body)
      expect(sendSellerEmailWithId).toHaveBeenLastCalledWith(
        expect.objectContaining({
          subject: f.queued().p_subject,
          text: f.queued().p_body,
        }),
      )
      if (kind !== 'message') {
        const automatic = client(language)
        const store = {
          tenantId: id,
          storeName,
          locale: 'en',
          policy: { automaticSellerNotifications: true },
        }
        expect(
          await notifyAfterFacts(automatic.value, store, [
            { kind, referenceId: id },
          ]),
        ).toEqual([
          { kind, referenceId: id, status: 'notified', delivery: 'sent' },
        ])
        expect(automatic.queued().p_locale).toBe(expected)
        expect(automatic.queued().p_subject).toBe(rendered.subject)
      }
    }
  },
)

it.each([undefined, 'sv', 'dk'] as const)(
  'welcome activation and submission replies use store default %s',
  async (language) => {
    const expected = language ?? 'en'
    const welcome = client(language)
    expect(
      await sendSellerCommunication(welcome.value, {
        tenantId: id,
        storeName,
        requestId: id,
        sellerId: id,
        kind: 'message',
        referenceId: null,
        freeText: '',
        welcome: true,
      }),
    ).toMatchObject({ ok: true, delivery: 'sent' })
    const rendered = renderSellerWelcome(
      expected,
      storeName,
      sellerName,
      appUrl,
    )
    expect(welcome.queued()).toMatchObject({
      p_locale: expected,
      p_subject: rendered.subject,
      p_body: rendered.body,
    })
    expect(sendSellerActivation).toHaveBeenLastCalledWith(
      'synthetic@example.test',
      expected,
      'ab'.repeat(32),
    )
    for (const manual of [false, true]) {
      const submission = client(language)
      expect(
        await notifySubmissionReview(
          submission.value,
          { tenantId: id, storeName },
          id,
          manual,
        ),
      ).toBe('sent')
      const reply = renderSubmissionReply(expected, storeName, id, appUrl)
      expect(submission.queued()).toMatchObject({
        p_locale: expected,
        p_subject: reply.subject,
        p_body: reply.body,
      })
      expect(sendSellerEmailWithId).toHaveBeenLastCalledWith(
        expect.objectContaining({ subject: reply.subject, text: reply.body }),
      )
    }
  },
)
