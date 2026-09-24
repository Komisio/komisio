import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  privacyOutcome,
  readShopifyPrivacy,
  recordShopifyPrivacyOutcome,
} from '@/lib/engine/shopify-privacy'

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
    const input = privacyOutcome
      .extend({ tenantId: z.uuid().nullable() })
      .parse(await boundedJson(request, 8192))
    if (input.tenantId !== null && input.tenantId !== ctx.active?.id)
      return reply({ error: 'FORBIDDEN' }, 403)
    // SQL enforces owner/admin or verified platform host, including for unmatched requests.
    const rows = await readShopifyPrivacy(ctx.client, input.tenantId)
    if (!rows.some((row) => row.id === input.requestId))
      return reply({ error: 'FORBIDDEN' }, 403)
    await recordShopifyPrivacyOutcome(ctx.client, input)
    return reply({ saved: true })
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    return reply(
      {
        error:
          code === 'REQUEST_CONFLICT' ? 'REQUEST_CONFLICT' : 'REQUEST_FAILED',
      },
      code === 'REQUEST_CONFLICT' ? 409 : 400,
    )
  }
}
