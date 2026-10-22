import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  managedWeblinkCommand,
  managedWeblinkConfigured,
  managedWeblinkErrors,
  manageHostedWeblink,
} from '@/lib/engine/managed-weblink'

export const maxDuration = 60

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  if (
    process.env.KOMISIO_INTAKE_ENABLED !== 'true' ||
    process.env.KOMISIO_WEBLINK_SETUP_ENABLED !== 'true' ||
    !managedWeblinkConfigured()
  )
    return reply({ error: 'NOT_FOUND' }, 404)
  if (
    !process.env.NEXT_PUBLIC_APP_URL ||
    request.headers.get('origin') !==
      new URL(process.env.NEXT_PUBLIC_APP_URL).origin
  )
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const parsed = managedWeblinkCommand.safeParse(
      await boundedJson(request, 1024).catch(() => null),
    )
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    return reply(await manageHostedWeblink(ctx.client, parsed.data))
  } catch (error) {
    const code =
      error instanceof Error &&
      managedWeblinkErrors.find((c) => c === error.message)
    return reply(
      { error: code || 'PRINT_MANAGED_REVIEW_REQUIRED' },
      code === 'FORBIDDEN' ? 403 : 409,
    )
  }
}
