import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  runPeriodNotices,
  handlePeriodNoticeCron,
} from '../../lib/engine/period-notices'
import { sendSellerCommunicationCommand } from '../../lib/engine/communications'
import {
  storePolicyBody,
  defaultStorePolicy,
} from '../../lib/engine/store-policy'
import { renderSellerMessage } from '../../lib/communications/templates'
import { locales } from '../../lib/i18n'

const id = 'f0000000-0000-4000-8000-000000000232'
const facts = {
  itemId: id,
  tenantId: id,
  sellerId: id,
  cycleId: id,
  kind: 'period_ending',
  dueAt: '2026-10-26T00:00:00+00:00',
  periodEnd: '2026-11-02T23:00:00+01:00',
  recipient: 'synthetic@example.test',
  locale: 'dk',
  policyId: null,
  preferenceId: null,
  storeName: 'Synthetic store',
  sellerName: 'Synthetic seller',
  itemLabel: 'Synthetic jacket',
}
function fixture(
  outcome: 'claimed' | 'lost' | 'stale' = 'claimed',
  finishError = false,
) {
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'period_notice_candidates')
      return {
        data: { candidates: [facts], checked: 1, wrapped: true },
        error: null,
      }
    if (name === 'claim_period_notice')
      return {
        data: outcome === 'claimed' ? args!.p_id : null,
        error: outcome === 'lost' ? { message: 'response lost' } : null,
      }
    if (name === 'finish_period_notice')
      return { data: args!.p_id, error: finishError ? {} : null }
    throw new Error(name)
  })
  return { rpc, client: { rpc } as unknown as SupabaseClient }
}
it.each(['lost', 'stale'] as const)(
  'does not call transport after a %s claim',
  async (outcome) => {
    const f = fixture(outcome),
      send = vi.fn()
    const result = await runPeriodNotices(f.client, {}, send)
    expect(send).not.toHaveBeenCalled()
    expect(result.attempted).toBe(0)
    expect(
      f.rpc.mock.calls.filter(([name]) => name === 'claim_period_notice'),
    ).toHaveLength(1)
  },
)
it('sends exactly the frozen rendered body once; failed result recording never resends', async () => {
  const f = fixture('claimed', true),
    send = vi
      .fn()
      .mockResolvedValue({ status: 'sent', providerMessageId: 'synthetic' })
  const result = await runPeriodNotices(f.client, {}, send)
  const claim = f.rpc.mock.calls.find(
    ([name]) => name === 'claim_period_notice',
  )![1]!
  expect(send).toHaveBeenCalledExactlyOnceWith(
    {
      communicationId: claim.p_id,
      to: facts.recipient,
      subject: claim.p_subject,
      text: claim.p_body,
    },
    {},
  )
  expect(claim.p_locale).toBe('dk')
  expect(result.failed).toBe(true)
})
it('records a thrown transport as unconfirmed without retrying', async () => {
  const f = fixture(),
    send = vi.fn().mockRejectedValue(new Error('connection lost'))
  await runPeriodNotices(f.client, {}, send)
  expect(send).toHaveBeenCalledTimes(1)
  expect(f.rpc).toHaveBeenLastCalledWith(
    'finish_period_notice',
    expect.objectContaining({ p_status: 'unconfirmed' }),
  )
})
it('caps scans even when every page reports more work', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({
      data: { candidates: [], checked: 40, wrapped: false },
      error: null,
    })
  const result = await runPeriodNotices(
    { rpc } as unknown as SupabaseClient,
    {},
    vi.fn(),
    () => 0,
  )
  expect(rpc).toHaveBeenCalledTimes(100)
  expect(result).toMatchObject({ complete: false, checked: 4000 })
})
it('does not start another page when the time budget is exhausted', async () => {
  const f = fixture(),
    now = vi.fn().mockReturnValueOnce(0).mockReturnValue(180000)
  expect((await runPeriodNotices(f.client, {}, vi.fn(), now)).complete).toBe(
    false,
  )
  expect(f.rpc).not.toHaveBeenCalled()
})
it('period kinds cannot enter the manual message command', () => {
  for (const kind of ['period_ending', 'period_ended'])
    expect(
      sendSellerCommunicationCommand.safeParse({
        tenantId: id,
        requestId: id,
        sellerId: id,
        referenceId: id,
        kind,
      }).success,
    ).toBe(false)
})
it('keeps the independent setting optional and rejects coerced values', () => {
  const base = defaultStorePolicy()
  expect(
    storePolicyBody.parse(base).automaticPeriodNotifications,
  ).toBeUndefined()
  expect(
    storePolicyBody.parse({
      ...base,
      automaticPeriodNotifications: true,
      automaticSellerNotifications: false,
    }).automaticPeriodNotifications,
  ).toBe(true)
  expect(
    storePolicyBody.parse({ ...base, automaticPeriodNotifications: false })
      .automaticPeriodNotifications,
  ).toBe(false)
  expect(
    storePolicyBody.safeParse({ ...base, automaticPeriodNotifications: 'true' })
      .success,
  ).toBe(false)
})
it.each(locales)('renders both period messages entirely in %s', (locale) => {
  for (const kind of ['period_ending', 'period_ended']) {
    const rendered = renderSellerMessage(kind, locale, {
      storeName: facts.storeName,
      sellerName: facts.sellerName,
      itemLabel: facts.itemLabel,
      date: facts.periodEnd,
    })
    expect(rendered.locale).toBe(locale)
    expect(rendered.body).toContain(facts.itemLabel)
    expect(rendered.body).not.toMatch(/\{\w+\}/)
  }
})
it('requires cron authorization before creating any authenticated client', async () => {
  const make = vi.fn(),
    env = {
      KOMISIO_INTAKE_ENABLED: 'true',
      KOMISIO_PERIOD_NOTICES_EMAIL: 'worker@example.test',
      KOMISIO_PERIOD_NOTICES_PASSWORD: 'synthetic',
      CRON_SECRET: 'synthetic-secret-12345',
      NEXT_PUBLIC_SUPABASE_URL: 'http://localhost',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'synthetic',
    }
  expect(
    (await handlePeriodNoticeCron(new Request('http://localhost'), env, make))
      .status,
  ).toBe(401)
  expect(
    (await handlePeriodNoticeCron(new Request('http://localhost'), {}, make))
      .status,
  ).toBe(404)
  expect(make).not.toHaveBeenCalled()
})
