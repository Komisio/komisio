import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn() }))
vi.mock('@/lib/platform/context', () => ({ requirePlatform: mocks.context }))
vi.mock('@/components/platform/working-form', () => ({
  WorkingForm: (props: object) => createElement('form', props),
}))
import StoreActivity from '../../app/(dashboard)/settings/activity/page'
import { dictionary, locales } from '../../lib/i18n'

afterEach(() => vi.restoreAllMocks())

it.each(locales)(
  'renders an inline read error and preserves retry filters in %s',
  async (locale) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.context.mockResolvedValue({
      active: { id: '11111111-1111-4111-8111-111111111111', role: 'owner' },
      locale,
      client: {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'PRIVATE ERROR' },
        }),
      },
    })
    const html = renderToStaticMarkup(
      await StoreActivity({
        searchParams: Promise.resolve({
          kind: 'zettle.automatic_started',
          page: '2',
          from: '2026-10-01',
        }),
      }),
    )
    const d = dictionary(locale)
    expect(html).toContain(d.activity.loadError)
    expect(html).toContain('role="alert"')
    expect(html).toContain('action="/settings/activity"')
    expect(html).toContain('method="get"')
    expect(html).toContain('name="kind" value="zettle.automatic_started"')
    expect(html).toContain('name="page" value="2"')
    expect(html).toContain('name="from" value="2026-10-01"')
    expect(html).toContain(d.retry)
    expect(html).not.toContain(d.activity.empty)
    expect(html).not.toContain('PRIVATE ERROR')
  },
)

it.each(['staff', 'readonly'])(
  'does not read activity for %s',
  async (role) => {
    const rpc = vi.fn()
    mocks.context.mockResolvedValue({
      active: { role },
      locale: 'sv',
      client: { rpc },
    })
    const html = renderToStaticMarkup(
      await StoreActivity({ searchParams: Promise.resolve({}) }),
    )
    expect(html).toContain(dictionary('sv').errors.FORBIDDEN)
    expect(rpc).not.toHaveBeenCalled()
  },
)

it('does not swallow authentication redirects', async () => {
  const redirect = new Error('NEXT_REDIRECT')
  mocks.context.mockRejectedValue(redirect)
  await expect(
    StoreActivity({ searchParams: Promise.resolve({}) }),
  ).rejects.toBe(redirect)
})
