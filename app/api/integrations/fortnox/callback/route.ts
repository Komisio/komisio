import { verifyState } from '@/lib/platform/credentials'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  completeFortnoxConnection,
  fortnoxErrorCode,
} from '@/lib/engine/fortnox-connection'
import { STATE_COOKIE } from '../connect/route'

/** Fortnox returns here with a code; the company is verified before anything is stored. */
export async function GET(request: Request) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) return new Response(null, { status: 403 })
  const back = (query: string) => {
    const response = NextResponse.redirect(
      new URL(`/intake/integrations?fortnox=${query}`, origin),
    )
    response.cookies.set(STATE_COOKIE, '', {
      path: '/api/integrations/fortnox',
      maxAge: 0,
    })
    return response
  }
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active) return back('AUTH_REQUIRED')
  const params = new URL(request.url).searchParams
  const code = params.get('code') ?? ''
  if (params.get('error') || !code) return back('FORTNOX_AUTH_REQUIRED')
  const cookieState =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${STATE_COOKIE}=`))
      ?.slice(STATE_COOKIE.length + 1) ?? null
  try {
    const bound = verifyState(
      'fortnox-connection',
      params.get('state'),
      process.env,
    )
    if (bound && bound.tenantId !== ctx.active.id) return back('TENANT_CHANGED')
    const result = await completeFortnoxConnection(
      ctx.client,
      { code, state: params.get('state'), cookieState },
      new URL('/api/integrations/fortnox/callback', origin).toString(),
      process.env,
    )
    if (result.tenantId !== ctx.active.id) return back('TENANT_CHANGED')
    return back('connected')
  } catch (e) {
    return back(fortnoxErrorCode(e instanceof Error ? e.message : ''))
  }
}
