import { NextRequest, NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  completePayPalConnection,
  PAYPAL_COOKIE,
  paypalErrorCode,
} from '@/lib/engine/paypal-credentials'

export async function GET(request: NextRequest) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) return new Response(null, { status: 403 })
  const back = (code: string) => {
    const response = NextResponse.redirect(
      new URL(`/intake/integrations?provider=paypal&paypal=${code}`, origin),
      303,
    )
    response.cookies.set(PAYPAL_COOKIE, '', {
      path: '/api/integrations/paypal',
      maxAge: 0,
      httpOnly: true,
      secure: new URL(origin).protocol === 'https:',
      sameSite: 'lax',
    })
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  }
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active) return back('AUTH_REQUIRED')
  const params = request.nextUrl.searchParams
  if (params.has('error')) return back('cancelled')
  if (!params.get('code')) return back('PAYPAL_STATE_INVALID')
  try {
    await completePayPalConnection(
      ctx.client,
      ctx.active.id,
      ctx.user.id,
      {
        code: params.get('code')!,
        state: params.get('state'),
        cookie: request.cookies.get(PAYPAL_COOKIE)?.value ?? null,
      },
      process.env,
    )
    return back('connected')
  } catch (error) {
    return back(paypalErrorCode(error instanceof Error ? error.message : ''))
  }
}
