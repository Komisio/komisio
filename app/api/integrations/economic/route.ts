import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  checkEconomicConnection,
  confirmEconomicSend,
  disconnectEconomic,
  economicCatalogue,
  economicErrorCode,
  economicMapBody,
  exportEconomicDayClose,
  publishEconomicMap,
  sendEconomicExport,
} from '@/lib/engine/economic'
import { EconomicError } from '@/extensions/economic/api'

const integer = z.number().int().positive().max(2147483647)
const command = z.discriminatedUnion('action', [
  z.strictObject({
    tenantId: z.uuid(),
    action: z.enum(['check', 'disconnect', 'catalogue']),
  }),
  z.strictObject({
    tenantId: z.uuid(),
    action: z.literal('publishMap'),
    requestId: z.uuid(),
    expectedCurrentId: z.uuid().nullable(),
    agreementNumber: integer,
    journalNumber: integer,
    map: economicMapBody,
  }),
  z.strictObject({
    tenantId: z.uuid(),
    action: z.literal('export'),
    dayCloseId: z.uuid(),
    requestId: z.uuid(),
  }),
  z.strictObject({
    tenantId: z.uuid(),
    action: z.literal('send'),
    exportId: z.uuid(),
    requestId: z.uuid(),
  }),
  z.strictObject({
    tenantId: z.uuid(),
    action: z.literal('confirm'),
    sendId: z.uuid(),
    journalNumber: integer,
    voucherNumber: z.number().int().min(0).max(999999999),
    evidence: z.string().trim().min(1).max(500),
  }),
])
export async function POST(request: Request) {
  const reply = (body: object, status = 200, retry?: number) =>
    NextResponse.json(body, {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        ...(retry ? { 'Retry-After': String(retry) } : {}),
      },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    const value = command.parse(await boundedJson(request, 32768))
    if (value.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    switch (value.action) {
      case 'check':
        return reply(
          await checkEconomicConnection(
            ctx.client,
            value.tenantId,
            process.env,
          ),
        )
      case 'disconnect':
        return reply(await disconnectEconomic(ctx.client, value.tenantId))
      case 'catalogue':
        return reply(
          await economicCatalogue(ctx.client, value.tenantId, process.env),
        )
      case 'publishMap': {
        const { action: _action, ...input } = value
        void _action
        return reply(await publishEconomicMap(ctx.client, input, process.env))
      }
      case 'export':
        return reply(
          await exportEconomicDayClose(
            ctx.client,
            value.tenantId,
            value.dayCloseId,
            value.requestId,
          ),
        )
      case 'send':
        return reply(
          await sendEconomicExport(
            ctx.client,
            value.tenantId,
            value.exportId,
            value.requestId,
            process.env,
          ),
        )
      case 'confirm':
        if (ctx.active.role !== 'owner')
          return reply({ error: 'FORBIDDEN' }, 403)
        return reply(
          await confirmEconomicSend(
            ctx.client,
            value.tenantId,
            value.sendId,
            value.journalNumber,
            value.voucherNumber,
            value.evidence,
          ),
        )
    }
  } catch (error) {
    const code = economicErrorCode(error)
    return reply(
      { error: code },
      code === 'FORBIDDEN'
        ? 403
        : code === 'INVALID_INPUT'
          ? 400
          : code === 'ECONOMIC_RATE_LIMITED'
            ? 429
            : 409,
      error instanceof EconomicError ? error.retrySeconds : undefined,
    )
  }
}
