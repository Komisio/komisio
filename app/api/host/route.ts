import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  activatePlanCommand,
  activatePlanManually,
  isPlatformHost,
  planErrorCode,
} from '@/lib/engine/plans'
import { z } from 'zod'
import {
  aiSettingsCommand,
  setAiPlatformSettings,
  setStoreShowcase,
  showcaseCommand,
} from '@/lib/engine/ai-credits'

/** Platform host actions: manual plan activation. The database decides who is a host. */
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
    if (!(await isPlatformHost(ctx.client)))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 2048)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const ai = z
      .discriminatedUnion('action', [
        z.strictObject({
          action: z.literal('aiSettings'),
          settings: aiSettingsCommand,
        }),
        showcaseCommand.extend({ action: z.literal('showcase') }),
      ])
      .safeParse(input)
    if (ai.success)
      return reply(
        ai.data.action === 'aiSettings'
          ? await setAiPlatformSettings(ctx.client, ai.data.settings)
          : await setStoreShowcase(ctx.client, {
              tenantId: ai.data.tenantId,
              label: ai.data.label,
            }),
      )
    const parsed = activatePlanCommand.safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    return reply(await activatePlanManually(ctx.client, parsed.data))
  } catch (e) {
    const code = planErrorCode(e instanceof Error ? e.message : '')
    return reply(
      { error: code },
      code === 'FORBIDDEN' ? 403 : code === 'INVALID_INPUT' ? 400 : 409,
    )
  }
}
