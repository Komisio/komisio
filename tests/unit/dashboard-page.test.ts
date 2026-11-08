import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { Overview } from '../../lib/engine/overview'

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  overview: vi.fn(),
  onboarding: vi.fn(),
  registrations: vi.fn(),
}))
vi.mock('@/lib/platform/context', () => ({ requirePlatform: mocks.context }))
vi.mock('@/lib/engine/overview', () => ({ readOverview: mocks.overview }))
vi.mock('@/lib/engine/onboarding', () => ({ readOnboarding: mocks.onboarding }))
vi.mock('@/lib/engine/seller-registration', () => ({
  readPendingRegistrationCount: mocks.registrations,
}))
vi.mock('@/components/platform/working-link', () => ({
  default: (props: object) => createElement('a', props),
}))
import Home from '../../app/(dashboard)/page'
import { dictionary, locales } from '../../lib/i18n'

const empty: Overview = {
  today: { salesCount: 0, grossOre: 0, currency: 'SEK' },
  openProposals: 0,
  attentionDays: 0,
  openPayouts: { count: 0, amountOre: 0 },
  owedOre: 0,
}
const context = (role = 'owner', locale = 'sv') => ({
  active: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Synthetic store',
    role,
  },
  locale,
  profile: { display_name: 'Synthetic operator' },
  client: {
    from: () => ({
      select: () => ({ eq: async () => ({ count: 2, error: null }) }),
    }),
  },
})
beforeEach(() => {
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  mocks.context.mockResolvedValue(context())
  mocks.overview.mockResolvedValue(empty)
  mocks.onboarding.mockResolvedValue([
    { key: 'account', done: true, path: '/account' },
  ])
  mocks.registrations.mockResolvedValue(0)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it('never hides unknown queues or describes an unavailable read as completed work', async () => {
  mocks.overview.mockResolvedValue({
    ...empty,
    openProposals: null,
    attentionDays: null,
    openPayouts: null,
  })
  const html = renderToStaticMarkup(await Home())
  expect(html).toContain('href="/intake/operations"')
  expect(html).toContain('href="/intake/accounting?view=reconciliation"')
  expect(html).toContain('href="/intake/payouts"')
  expect(html).toContain(dictionary('sv').dashboard.unavailable)
  expect(html).not.toContain(dictionary('sv').dashboard.nothingPending)
})

it('collapses only confirmed zero-count queues and keeps the disclosure available', async () => {
  const html = renderToStaticMarkup(await Home())
  expect(html).toContain(dictionary('sv').dashboard.nothingPending)
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('href="/intake/payouts"')
  expect(html).not.toContain('href="/intake/sellers/registrations"')
})

it.each(locales)(
  'keeps active work, unavailable money and setup guidance in %s',
  async (locale) => {
    mocks.context.mockResolvedValue(context('owner', locale))
    mocks.registrations.mockResolvedValue(2)
    mocks.overview.mockResolvedValue({
      ...empty,
      today: null,
      owedOre: null,
      attentionDays: 3,
    })
    const html = renderToStaticMarkup(await Home())
    const d = dictionary(locale)
    expect(html).toContain('href="/intake/sellers/registrations"')
    expect(html).toContain(d.dashboard.daysPending.replace('{count}', '3'))
    expect(html).toContain(d.dashboard.thisMonth)
    expect(html).toContain(d.dashboard.unavailable)
    expect(html).not.toContain(d.dashboard.nothingPending)
    expect(html).toContain('href="/guide"')
    expect(html).toContain('href="/account"')
    expect(html).toContain('<details class="dashboard-help">')
  },
)

it('uses Swedish money without changing amounts and distinguishes one day from several', async () => {
  mocks.overview.mockResolvedValue({
    ...empty,
    today: { salesCount: 2, grossOre: 48400, currency: 'SEK' },
    owedOre: 72960,
    attentionDays: 1,
  })
  const html = renderToStaticMarkup(await Home())
  expect(html).toContain('484,00 kr')
  expect(html).toContain('729,60 kr')
  expect(html).toContain(
    dictionary('sv').dashboard.dayPending.replace('{count}', '1'),
  )
})

it('keeps receiving actions and registration counts unavailable to readonly members', async () => {
  mocks.context.mockResolvedValue(context('readonly'))
  const html = renderToStaticMarkup(await Home())
  expect(html).not.toContain('class="dashboard-actions"')
  expect(html).not.toContain('href="/intake/sellers/registrations"')
  expect(mocks.registrations).not.toHaveBeenCalled()
})

it('retains open setup guidance when intake is disabled without reading domain summaries', async () => {
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'false')
  const html = renderToStaticMarkup(await Home())
  expect(html).toContain('<details class="dashboard-help" open="">')
  expect(html).not.toContain('class="dashboard-actions"')
  expect(mocks.overview).not.toHaveBeenCalled()
  expect(mocks.onboarding).not.toHaveBeenCalled()
  expect(mocks.registrations).not.toHaveBeenCalled()
})
