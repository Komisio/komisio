import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { executeIntake, intakeCommand } from '@/lib/engine/intake'

export async function POST(request: Request) {
  const requestId = randomUUID()
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', 'X-Request-Id': requestId },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    // Enforce an actual streamed byte limit, including requests without Content-Length.
    const reader = request.body?.getReader()
    if (!reader) return reply({ error: 'INVALID_INPUT' }, 400)
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 64000) {
        await reader.cancel()
        return reply({ error: 'INVALID_INPUT' }, 413)
      }
      chunks.push(value)
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = intakeCommand.safeParse(body)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
    if (
      ['publishAgreement', 'publishStorePolicy', 'adjustSellerLedger'].includes(
        parsed.data.action,
      ) &&
      !['owner', 'admin'].includes(ctx.active.role)
    )
      return reply({ error: 'FORBIDDEN' }, 403)
    const result = await executeIntake(ctx.client, parsed.data)
    if (result.error) {
      const code =
        [
          'FORBIDDEN',
          'AUTH_REQUIRED',
          'REQUEST_CONFLICT',
          'SELLER_NOT_FOUND',
          'INVALID_INPUT',
          'AGREEMENT_CHANGED',
          'POLICY_CHANGED',
          'AGREEMENT_REQUIRED',
          'INSPECTION_DRAFT_CHANGED',
          'INSPECTION_CONTEXT_CHANGED',
          'INSPECTION_ARCHIVED',
          'INSPECTION_STATUS_UNCHANGED',
          'INSPECTION_NOT_FOUND',
          'BAG_NOT_FOUND',
          'RECEPTION_NOT_FOUND',
          'RECEPTION_CHANGED',
          'RECEPTION_SOURCE_CHANGED',
          'RECEPTION_REVIEW_CHANGED',
          'RECEPTION_REVIEW_EXPIRED',
          'RECEPTION_UNKNOWN_SOURCE',
          'RECEPTION_PRICE_EVIDENCE_REQUIRED',
          'GARMENT_ALREADY_RECEIVED',
          'SELLER_TERMS_CHANGED',
          'ORIGIN_NOT_FOUND',
          'ITEM_EXISTS',
          'CUSTODY_REQUIRED',
          'SELLER_APPROVAL_REQUIRED',
          'PRICE_NOT_APPROVED',
          'ITEM_NOT_FOUND',
          'ITEM_ALREADY_SOLD',
          'VAT_MODE_NOT_SET',
          'VAT_BASIS_MISSING',
          'SALE_CONFLICT',
        ].find((v) => result.error!.message.includes(v)) ?? 'REQUEST_FAILED'
      return reply(
        { error: code },
        code === 'FORBIDDEN'
          ? 403
          : [
                'REQUEST_CONFLICT',
                'AGREEMENT_CHANGED',
                'POLICY_CHANGED',
                'AGREEMENT_REQUIRED',
                'INSPECTION_DRAFT_CHANGED',
                'INSPECTION_CONTEXT_CHANGED',
                'INSPECTION_ARCHIVED',
                'INSPECTION_STATUS_UNCHANGED',
                'RECEPTION_CHANGED',
                'RECEPTION_SOURCE_CHANGED',
                'RECEPTION_REVIEW_CHANGED',
                'RECEPTION_REVIEW_EXPIRED',
                'GARMENT_ALREADY_RECEIVED',
                'SELLER_TERMS_CHANGED',
                'ITEM_EXISTS',
                'CUSTODY_REQUIRED',
                'SELLER_APPROVAL_REQUIRED',
                'PRICE_NOT_APPROVED',
                'ITEM_ALREADY_SOLD',
                'VAT_MODE_NOT_SET',
                'SALE_CONFLICT',
              ].includes(code)
            ? 409
            : 400,
      )
    }
    return reply({ ok: true, id: result.data })
  } catch {
    console.error('Intake request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
