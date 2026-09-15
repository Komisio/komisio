import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { startShopifyConnection } from '@/lib/engine/shopify-connection'
import { shopDomain } from '@/extensions/shopify/auth'

export const STATE_COOKIE = 'komisio-shopify-state'

/** Starts the Shopify authorisation for the active store and a named shop; owner or admin. */
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
  const params = new URL(request.url).searchParams
  const tenant = z.uuid().safeParse(params.get('tenant'))
  if (!tenant.success || tenant.data !== ctx.active.id)
    return new Response(null, { status: 409 })
  const back = (code: string) =>
    NextResponse.redirect(
      new URL(
        `/intake/integrations?shopify=${encodeURIComponent(code)}`,
        origin,
      ),
    )
  const shop = shopDomain.safeParse(params.get('shop') ?? '')
  if (!shop.success) return back('INVALID_INPUT')
  try {
    const redirectUri = new URL(
      '/api/integrations/shopify/callback',
      origin,
    ).toString()
    const { url, state } = await startShopifyConnection(
      ctx.client,
      ctx.active.id,
      shop.data,
      redirectUri,
      process.env,
    )
    const response = NextResponse.redirect(url)
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: origin.startsWith('https://'),
      path: '/api/integrations/shopify',
      maxAge: 600,
    })
    return response
  } catch (e) {
    return back(e instanceof Error ? e.message : 'REQUEST_FAILED')
  }
}
