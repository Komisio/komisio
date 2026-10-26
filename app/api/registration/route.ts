import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { registrationCommand } from '@/lib/engine/registration'
import { executeRegistration } from '@/lib/engine/registration-store'
import { boundedJson } from '@/lib/http/bounded-json'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    let input: unknown
    try {
      input = await boundedJson(request, 16000)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = registrationCommand.safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (c.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (
      !(
        c.action === 'settings'
          ? ['owner', 'admin']
          : ['owner', 'admin', 'staff']
      ).includes(ctx.active.role)
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(await executeRegistration(ctx.client, c))
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    if (
      [
        'FORBIDDEN',
        'AUTH_REQUIRED',
        'INVALID_INPUT',
        'REQUEST_CONFLICT',
        'REGISTRATION_CHANGED',
        'NOTE_CHANGED',
        'ITEM_NOT_FOUND',
      ].includes(code)
    )
      return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 409)
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
