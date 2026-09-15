import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  completeShopifyConnection,
  shopifyErrorCode,
} from '@/lib/engine/shopify-connection'
import { STATE_COOKIE } from '../connect/route'

/** Shopify returns here with a code; the shop is verified before anything is stored. */
export async function GET(request: Request) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404 })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) return new Response(null, { status: 403 })
  const back = (query: string) => {
    const response = NextResponse.redirect(
      new URL(`/intake/integrations?shopify=${query}`, origin),
    )
    response.cookies.set(STATE_COOKIE, '', {
      path: '/api/integrations/shopify',
      maxAge: 0,
    })
    return response
  }
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired || !ctx.active) return back('AUTH_REQUIRED')
  const params = new URL(request.url).searchParams
  if (params.get('error') || !params.get('code'))
    return back('SHOPIFY_AUTH_REQUIRED')
  const cookieState =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${STATE_COOKIE}=`))
      ?.slice(STATE_COOKIE.length + 1) ?? null
  try {
    const result = await completeShopifyConnection(
      ctx.client,
      { params, cookieState },
      process.env,
    )
    if (result.tenantId !== ctx.active.id) return back('TENANT_CHANGED')
    return back('connected')
  } catch (e) {
    return back(shopifyErrorCode(e instanceof Error ? e.message : ''))
  }
}
