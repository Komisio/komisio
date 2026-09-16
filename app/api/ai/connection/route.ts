import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  aiCreditsErrorCode,
  readAiCredits,
  removeOwnKey,
  storeOwnKey,
} from '@/lib/engine/ai-credits'
import { credentialKeyConfigured } from '@/lib/platform/credentials'

/** Owner or admin: connect the store's own model key (sealed at once), or remove it. */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 2048)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({
        tenantId: z.uuid(),
        action: z.enum(['connect', 'remove']),
        model: z.string().optional(),
        key: z.string().optional(),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (parsed.data.action === 'connect') {
      if (!credentialKeyConfigured())
        return reply({ error: 'CREDENTIAL_KEY_MISSING' }, 503)
      await storeOwnKey(ctx.client, {
        tenantId: ctx.active.id,
        provider: 'openai',
        model: parsed.data.model?.trim() ?? '',
        key: parsed.data.key?.trim() ?? '',
      })
    } else await removeOwnKey(ctx.client, ctx.active.id)
    return reply({ credits: await readAiCredits(ctx.client, ctx.active.id) })
  } catch (e) {
    const code = aiCreditsErrorCode(e instanceof Error ? e.message : '')
    return reply(
      { error: code },
      code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400 : 409,
    )
  }
}
