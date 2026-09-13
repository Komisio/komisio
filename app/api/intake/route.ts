import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { executeIntake, intakeCommand } from '@/lib/engine/intake'
import { readStorePolicy } from '@/lib/engine/store-policy'
import {
  notifyAfterFacts,
  notificationsForIntake,
  type NotifyOutcome,
} from '@/lib/communications/dispatch'

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
      [
        'publishAgreement',
        'publishStorePolicy',
        'adjustSellerLedger',
        'registerPrinter',
        'publishAccountingMap',
        'publishStoreProfile',
      ].includes(parsed.data.action) &&
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
          'PAYOUT_NOT_FOUND',
          'PAYOUT_BELOW_THRESHOLD',
          'PAYOUT_EXCEEDS_BALANCE',
          'PAYOUT_NOT_REQUESTED',
          'PAYOUT_NOT_APPROVED',
          'PAYOUT_DECIDED',
          'PAYOUT_PENDING',
          'PROFILE_CHANGED',
          'HANDOVER_NOT_FOUND',
          'HANDOVER_DECIDED',
          'CUSTODY_SOURCE_NOT_ALLOWED',
          'SALE_LINE_NOT_FOUND',
          'SALE_NOT_COMPLETED',
          'LINE_ALREADY_RETURNED',
          'PARTIAL_REFUND_UNSUPPORTED',
          'STATEMENT_NOT_FOUND',
          'STATEMENT_ALREADY_CORRECTED',
          'STATEMENT_PERIOD_OVERLAP',
          'MARKDOWN_NOT_DUE',
          'MARKDOWN_ALREADY_APPLIED',
          'ITEM_NOT_ON_SALE',
          'ITEM_ENDED',
          'PRINTER_NOT_FOUND',
          'PRINTER_INACTIVE',
          'PRINT_JOB_NOT_FOUND',
          'PRINT_JOB_DECIDED',
          'MAP_CHANGED',
          'ACCOUNTING_MAP_REQUIRED',
          'DAY_CLOSE_NOT_FOUND',
          'VOUCHER_UNBALANCED',
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
                'PAYOUT_EXCEEDS_BALANCE',
                'PAYOUT_NOT_REQUESTED',
                'PAYOUT_NOT_APPROVED',
                'PAYOUT_DECIDED',
                'PAYOUT_PENDING',
                'PROFILE_CHANGED',
                'HANDOVER_DECIDED',
                'CUSTODY_SOURCE_NOT_ALLOWED',
                'PAYOUT_BELOW_THRESHOLD',
                'SALE_NOT_COMPLETED',
                'LINE_ALREADY_RETURNED',
                'STATEMENT_ALREADY_CORRECTED',
                'STATEMENT_PERIOD_OVERLAP',
                'MARKDOWN_NOT_DUE',
                'MARKDOWN_ALREADY_APPLIED',
                'ITEM_NOT_ON_SALE',
                'ITEM_ENDED',
                'PRINTER_INACTIVE',
                'PRINT_JOB_DECIDED',
                'MAP_CHANGED',
                'VOUCHER_UNBALANCED',
                'ACCOUNTING_MAP_REQUIRED',
              ].includes(code)
            ? 409
            : 400,
      )
    }
    // Automatic seller notifications (S18): after the fact is committed, when
    // the store opted in. Failures never undo or hide the recorded fact.
    let notifications: NotifyOutcome[] = []
    if (
      [
        'acceptItem',
        'recordSale',
        'approvePayout',
        'markPayoutPaid',
        'settlePayouts',
        'issueStatement',
      ].includes(parsed.data.action)
    ) {
      try {
        const policy = await readStorePolicy(ctx.client, parsed.data.tenantId)
        notifications = await notifyAfterFacts(
          ctx.client,
          {
            tenantId: parsed.data.tenantId,
            storeName: ctx.active.name,
            locale: ctx.locale,
            policy: policy.policy,
          },
          await notificationsForIntake(ctx.client, parsed.data),
        )
      } catch {
        console.error('Notification after intake failed', { requestId })
      }
    }
    return reply({ ok: true, id: result.data, notifications })
  } catch {
    console.error('Intake request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
