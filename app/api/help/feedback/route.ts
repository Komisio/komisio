import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  helpFeedbackInput,
  submitHelpFeedback,
} from '@/lib/engine/help-feedback'

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
    if (
      !ctx.active ||
      !['owner', 'admin', 'staff', 'readonly'].includes(ctx.active.role)
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    const value = helpFeedbackInput.parse(await boundedJson(request, 12000))
    if (value.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    await submitHelpFeedback(ctx.client, value)
    return reply({ submitted: true })
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? 'INVALID_INPUT'
        : error instanceof Error &&
            [
              'RATE_LIMITED',
              'FORBIDDEN',
              'AUTH_REQUIRED',
              'INVALID_INPUT',
            ].includes(error.message)
          ? error.message
          : 'REQUEST_FAILED'
    return reply(
      { error: code },
      code === 'RATE_LIMITED'
        ? 429
        : code === 'FORBIDDEN'
          ? 403
          : code === 'INVALID_INPUT'
            ? 400
            : code === 'AUTH_REQUIRED'
              ? 401
              : 503,
    )
  }
}
