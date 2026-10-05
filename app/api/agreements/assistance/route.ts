import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  agreementAssistanceCommand,
  runAgreementAssistance,
} from '@/lib/engine/agreement-assistance'
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
    const c = agreementAssistanceCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply(
      await runAgreementAssistance(
        ctx.client,
        c.data,
        AbortSignal.any([request.signal, AbortSignal.timeout(45000)]),
      ),
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const known = [
      'ASSISTANCE_DISABLED',
      'ASSISTANCE_LIMIT',
      'USAGE_QUOTA_EXCEEDED',
      'AI_CREDITS_EXHAUSTED',
      'AI_CAP_REACHED',
      'AGREEMENT_CHANGED',
      'REQUEST_CONFLICT',
      'FORBIDDEN',
    ]
    return reply(
      { error: known.includes(code) ? code : 'ASSISTANCE_FAILED' },
      code === 'FORBIDDEN'
        ? 403
        : ['AGREEMENT_CHANGED', 'REQUEST_CONFLICT'].includes(code)
          ? 409
          : 502,
    )
  }
}
