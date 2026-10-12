import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  saveSyncPreference,
  saveSyncPreferenceInput,
} from '@/lib/engine/sync-preferences'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const input = saveSyncPreferenceInput.safeParse(
      await boundedJson(request, 4096).catch(() => null),
    )
    if (!input.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== input.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(await saveSyncPreference(ctx.client, input.data))
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    return reply(
      {
        error: [
          'FORBIDDEN',
          'REQUEST_CONFLICT',
          'SYNC_CONNECTION_CHANGED',
          'SYNC_SETTINGS_CHANGED',
        ].includes(code)
          ? code
          : 'REQUEST_FAILED',
      },
      [
        'FORBIDDEN',
        'REQUEST_CONFLICT',
        'SYNC_CONNECTION_CHANGED',
        'SYNC_SETTINGS_CHANGED',
      ].includes(code)
        ? 409
        : 500,
    )
  }
}
