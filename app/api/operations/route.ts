import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  decideOperationCommand,
  decideOperation,
  operationErrorCode,
} from '@/lib/engine/operations'
import { readStorePolicy } from '@/lib/engine/store-policy'
import {
  notifyAfterFacts,
  notificationsForOperation,
  sendSellerCommunication,
  type NotifyOutcome,
} from '@/lib/communications/dispatch'
import { sendMessagePayload } from '@/lib/engine/operations'
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
    const c = decideOperationCommand.safeParse(input)
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const result = await decideOperation(ctx.client, c.data)
    if (result.error) {
      const code = operationErrorCode(result.error.message)
      return reply(
        { error: code },
        ['FORBIDDEN', 'AUTH_REQUIRED'].includes(code)
          ? 403
          : code === 'INVALID_INPUT'
            ? 400
            : 409,
      )
    }
    // Automatic seller notifications (S18) after an executed approval, when
    // the store opted in. Never affects the recorded decision.
    let notifications: NotifyOutcome[] = []
    if (c.data.decision === 'approve') {
      try {
        const [operation, decision] = await Promise.all([
          ctx.client
            .from('pending_operations')
            .select('kind,payload')
            .eq('tenant_id', c.data.tenantId)
            .eq('id', c.data.operationId)
            .maybeSingle(),
          ctx.client
            .from('operation_decisions')
            .select('outcome')
            .eq('tenant_id', c.data.tenantId)
            .eq('id', c.data.requestId)
            .maybeSingle(),
        ])
        const facts =
          decision.data?.outcome === 'executed' && operation.data
            ? notificationsForOperation(
                String(operation.data.kind),
                c.data.operationId,
                operation.data.payload,
              )
            : []
        // An approved template-bound message: the approval is the fact, the
        // send follows now with the operation id as the communication id.
        if (
          decision.data?.outcome === 'executed' &&
          operation.data?.kind === 'sendMessage'
        ) {
          const p = sendMessagePayload.parse(operation.data.payload)
          const sent = await sendSellerCommunication(ctx.client, {
            tenantId: c.data.tenantId,
            storeName: ctx.active.name,
            locale: p.locale,
            requestId: c.data.operationId,
            sellerId: p.sellerId,
            kind: 'message',
            referenceId: null,
            freeText: p.freeText,
          })
          notifications = [
            sent.ok
              ? {
                  kind: 'message',
                  referenceId: c.data.operationId,
                  status: 'notified',
                  delivery: sent.delivery,
                }
              : {
                  kind: 'message',
                  referenceId: c.data.operationId,
                  status: 'skipped',
                  why: sent.error,
                },
          ]
        }
        if (facts.length) {
          const policy = await readStorePolicy(ctx.client, c.data.tenantId)
          notifications = await notifyAfterFacts(
            ctx.client,
            {
              tenantId: c.data.tenantId,
              storeName: ctx.active.name,
              locale: ctx.locale,
              policy: policy.policy,
            },
            facts,
          )
        }
      } catch {
        console.error('Notification after decision failed')
      }
    }
    return reply({ id: result.data, notifications })
  } catch {
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
