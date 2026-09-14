import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { readSellerMatches } from '@/lib/engine/sellers'

const headers = { 'Cache-Control': 'no-store' }

/** Sellers already registered with the contact details typed at the counter. Any member; nothing is written. */
export async function GET(request: Request) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers })
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired || !ctx.active)
      return NextResponse.json(
        { error: 'AUTH_REQUIRED' },
        { status: 401, headers },
      )
    const q = new URL(request.url).searchParams
    const field = (name: string, max: number) =>
      (q.get(name) ?? '').trim().slice(0, max)
    const result = await readSellerMatches(ctx.client, ctx.active.id, {
      name: field('name', 120),
      email: field('email', 254),
      phone: field('phone', 40),
    })
    return NextResponse.json(result, { headers })
  } catch {
    return NextResponse.json({ error: 'FAILED' }, { status: 500, headers })
  }
}
