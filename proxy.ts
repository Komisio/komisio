import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isLocale } from './lib/i18n'
import { signupBlocked, signupPath } from './lib/platform/signup-countries'
export async function proxy(request: NextRequest) {
  // Opening a new store can be closed to named countries; everything else,
  // including signing in and running an existing store, stays open from
  // everywhere, so an owner who travels is never locked out of their own shop.
  if (
    signupPath(request.nextUrl.pathname) &&
    signupBlocked(
      process.env.KOMISIO_BLOCKED_SIGNUP_COUNTRIES,
      request.headers.get('x-vercel-ip-country'),
    )
  )
    return new NextResponse(
      'Komisio is not open for new stores in your country. If this is wrong, write to support@komisio.com.',
      {
        status: 403,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'private, no-store',
        },
      },
    )
  // An explicit product-site language wins over an older browser preference.
  const lang = request.nextUrl.searchParams.get('lang')
  const locale =
    request.nextUrl.pathname === '/register' && isLocale(lang)
      ? lang
      : undefined
  if (locale) request.cookies.set('komisio-locale', locale)
  function nextResponse() {
    const result = NextResponse.next({ request })
    if (locale) {
      result.cookies.set('komisio-locale', locale, {
        path: '/',
        sameSite: 'lax',
      })
      result.headers.set('Cache-Control', 'private, no-store')
    }
    return result
  }
  let response = nextResponse()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return response
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value))
        response = nextResponse()
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })
  await client.auth.getClaims()
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
