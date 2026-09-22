import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { startFortnoxConnection } from '@/lib/engine/fortnox-connection'

export const STATE_COOKIE = 'komisio-fortnox-state'

/** Starts the Fortnox authorisation for the active store; owner or admin. */
export async function GET(request: Request) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) return new Response(null, { status: 403 })
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active)
    return NextResponse.redirect(
      new URL('/login?next=%2Fintake%2Fintegrations', origin),
    )
  if (!['owner', 'admin'].includes(ctx.active.role))
    return new Response(null, { status: 403 })
  const tenant = z
    .uuid()
    .safeParse(new URL(request.url).searchParams.get('tenant'))
  if (!tenant.success || tenant.data !== ctx.active.id)
    return new Response(null, { status: 409 })
  try {
    const redirectUri = new URL(
      '/api/integrations/fortnox/callback',
      origin,
    ).toString()
    const { url, state } = await startFortnoxConnection(
      ctx.client,
      ctx.active.id,
      redirectUri,
      process.env,
    )
    const response = NextResponse.redirect(url)
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      path: '/api/integrations/fortnox',
      maxAge: 600,
    })
    return response
  } catch (e) {
    const code = e instanceof Error ? e.message : 'REQUEST_FAILED'
    return NextResponse.redirect(
      new URL(
        `/intake/integrations?fortnox=${encodeURIComponent(code)}`,
        origin,
      ),
    )
  }
}
