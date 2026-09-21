import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../../proxy'
import { locales } from '../../lib/i18n'

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          values: { name: string; value: string; options: { path: string } }[],
        ) => void
      }
    },
  ) => ({
    auth: {
      getClaims: async () => {
        options.cookies.setAll([
          { name: 'session', value: 'refreshed', options: { path: '/' } },
        ])
      },
    },
  }),
}))

afterEach(() => vi.unstubAllEnvs())

describe('product-site registration language', () => {
  it.each(locales)(
    'uses explicit %s for server rendering and subsequent pages',
    async (locale) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
      const request = new NextRequest(
        `https://app.komisio.com/register?lang=${locale}&next=%2Fonboarding`,
        {
          headers: {
            cookie: `komisio-locale=${locale === 'sv' ? 'en' : 'sv'}`,
          },
        },
      )
      const response = await proxy(request)
      expect(request.cookies.get('komisio-locale')?.value).toBe(locale)
      expect(response.headers.get('x-middleware-request-cookie')).toContain(
        `komisio-locale=${locale}`,
      )
      expect(response.cookies.get('komisio-locale')).toMatchObject({
        value: locale,
        path: '/',
        sameSite: 'lax',
      })
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(request.nextUrl.searchParams.get('next')).toBe('/onboarding')
    },
  )

  it.each(['/register', '/register?lang=invalid', '/login?lang=sv'])(
    'preserves the existing preference for %s',
    async (path) => {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
      const request = new NextRequest(`https://app.komisio.com${path}`, {
        headers: { cookie: 'komisio-locale=en' },
      })
      const response = await proxy(request)
      expect(request.cookies.get('komisio-locale')?.value).toBe('en')
      expect(response.cookies.get('komisio-locale')).toBeUndefined()
    },
  )

  it('keeps the language when Supabase refreshes session cookies', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key')
    const request = new NextRequest('https://app.komisio.com/register?lang=sv')
    const response = await proxy(request)
    expect(response.cookies.get('komisio-locale')?.value).toBe('sv')
    expect(response.cookies.get('session')?.value).toBe('refreshed')
    expect(response.headers.get('x-middleware-request-cookie')).toContain(
      'komisio-locale=sv',
    )
  })
})
