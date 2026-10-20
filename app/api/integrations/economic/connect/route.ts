import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  economicErrorCode,
  startEconomicConnection,
  ECONOMIC_STATE_COOKIE,
} from '@/lib/engine/economic'

export async function GET(request: Request) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) return new Response(null, { status: 403 })
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active)
    return NextResponse.redirect(
      new URL('/login?next=%2Fintake%2Faccounting%3Fview%3Dsettings', origin),
    )
  if (!['owner', 'admin'].includes(ctx.active.role))
    return new Response(null, { status: 403 })
  if (new URL(request.url).searchParams.get('tenant') !== ctx.active.id)
    return new Response(null, { status: 409 })
  try {
    const result = await startEconomicConnection(
      ctx.client,
      ctx.active.id,
      new URL('/api/integrations/economic/callback', origin).toString(),
      ctx.locale,
      process.env,
    )
    const response = NextResponse.redirect(result.url)
    response.cookies.set(ECONOMIC_STATE_COOKIE, result.state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      path: '/api/integrations/economic',
      maxAge: 600,
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    return NextResponse.redirect(
      new URL(
        `/intake/accounting?view=settings&economic=${economicErrorCode(error)}#economic-connection`,
        origin,
      ),
    )
  }
}
