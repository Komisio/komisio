import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import { assistanceCommand } from '@/lib/engine/reception-assistance'
import { runReceptionAssistance } from '@/lib/assistance/run-reception'
export const maxDuration = 60
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    let input: unknown
    try {
      input = await boundedJson(request)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const c = assistanceCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(
      await runReceptionAssistance(
        ctx.client,
        c.data,
        AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
      ),
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'FORBIDDEN') return reply({ error: code }, 403)
    if (code === 'ASSISTANCE_LIMIT' || code === 'USAGE_QUOTA_EXCEEDED')
      return reply({ error: code }, 429)
    if (
      [
        'ASSISTANCE_ALREADY_ATTEMPTED',
        'RECEPTION_CHANGED',
        'REQUEST_CONFLICT',
      ].includes(code)
    )
      return reply({ error: code }, 409)
    return reply({ error: 'ASSISTANCE_FAILED' }, 502)
  }
}
