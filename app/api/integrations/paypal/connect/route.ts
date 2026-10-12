import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  startPayPalConnection,
  PAYPAL_COOKIE,
  paypalErrorCode,
} from '@/lib/engine/paypal-credentials'

export async function POST(request: Request) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return new Response(null, { status: 403 })
  const back = (code: string) =>
    NextResponse.redirect(
      new URL(`/intake/integrations?provider=paypal&paypal=${code}`, origin),
      303,
    )
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active) return back('AUTH_REQUIRED')
  if (!['owner', 'admin'].includes(ctx.active.role))
    return new Response(null, { status: 403 })
  if (new URL(request.url).searchParams.get('tenant') !== ctx.active.id)
    return back('TENANT_CHANGED')
  try {
    const { url, cookie } = await startPayPalConnection(
      ctx.client,
      ctx.active.id,
      ctx.user.id,
      new URL('/api/integrations/paypal/callback', origin).toString(),
      process.env,
    )
    const response = NextResponse.redirect(url, 303)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.cookies.set(PAYPAL_COOKIE, cookie, {
      httpOnly: true,
      secure: new URL(origin).protocol === 'https:',
      sameSite: 'lax',
      path: '/api/integrations/paypal',
      maxAge: 600,
    })
    return response
  } catch (error) {
    return back(paypalErrorCode(error instanceof Error ? error.message : ''))
  }
}
