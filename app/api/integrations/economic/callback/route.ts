import { NextResponse, type NextRequest } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  completeEconomicConnection,
  economicErrorCode,
  ECONOMIC_STATE_COOKIE,
} from '@/lib/engine/economic'

export async function GET(request: NextRequest) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) return new Response(null, { status: 403 })
  const back = (result: string) => {
    const response = NextResponse.redirect(
      new URL(
        `/intake/accounting?view=settings&economic=${result}#economic-connection`,
        origin,
      ),
    )
    response.cookies.set(ECONOMIC_STATE_COOKIE, '', {
      path: '/api/integrations/economic',
      maxAge: 0,
    })
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active) return back('AUTH_REQUIRED')
  try {
    await completeEconomicConnection(
      ctx.client,
      {
        tenantId: ctx.active.id,
        grant: request.nextUrl.searchParams.get('token') ?? '',
        state: request.nextUrl.searchParams.get('state'),
        cookieState: request.cookies.get(ECONOMIC_STATE_COOKIE)?.value ?? null,
      },
      process.env,
    )
    return back('connected')
  } catch (error) {
    return back(economicErrorCode(error))
  }
}
