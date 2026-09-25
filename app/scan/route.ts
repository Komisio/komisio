import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { safeNext } from '@/lib/platform/validation'
/** Authentication entry outside the dashboard layout; a code never grants access. */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return new Response(null, { status: 404, headers })
  const ref = (new URL(request.url).searchParams.get('ref') ?? '')
    .trim()
    .toUpperCase()
  const target = safeNext('/intake/open?ref=' + ref)
  if (target === '/') return new Response(null, { status: 400, headers })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return new Response(null, { status: 503, headers })
  const ctx = await platformContext()
  const path = !ctx
    ? '/login?next=' + encodeURIComponent(target)
    : ctx.mfaRequired
      ? '/mfa?next=' + encodeURIComponent(target)
      : target
  return NextResponse.redirect(new URL(path, new URL(appUrl).origin), {
    headers,
  })
}
