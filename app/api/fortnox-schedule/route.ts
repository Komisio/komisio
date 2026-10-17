import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  saveFortnoxSchedule,
  saveFortnoxScheduleInput,
} from '@/lib/engine/fortnox-schedule'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    Response.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  const ctx = await platformContext()
  if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
  if (ctx.active?.role !== 'owner') return reply({ error: 'FORBIDDEN' }, 403)
  let input: unknown
  try {
    input = await boundedJson(request, 2048)
  } catch {
    return reply({ error: 'INVALID_INPUT' }, 400)
  }
  const parsed = saveFortnoxScheduleInput.safeParse(input)
  if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
  if (parsed.data.tenantId !== ctx.active.id)
    return reply({ error: 'TENANT_CHANGED' }, 409)
  try {
    return reply(await saveFortnoxSchedule(ctx.client, parsed.data))
  } catch (e) {
    const code =
      e instanceof Error &&
      [
        'FORBIDDEN',
        'INVALID_INPUT',
        'REQUEST_CONFLICT',
        'FORTNOX_SCHEDULE_CHANGED',
      ].includes(e.message)
        ? e.message
        : 'REQUEST_FAILED'
    return reply(
      { error: code },
      code === 'FORBIDDEN' ? 403 : code === 'REQUEST_FAILED' ? 500 : 409,
    )
  }
}
