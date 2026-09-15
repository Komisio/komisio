import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  createPairingCode,
  errorCode,
  readPrintDevices,
  revokePrintDevice,
} from '@/lib/engine/print-devices'

/** Owner or admin: a pairing code for a printer, or revoke a device. */
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
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 1024)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({
        tenantId: z.uuid(),
        action: z.enum(['pairingCode', 'revoke']),
        printerId: z.guid().optional(),
        deviceId: z.guid().optional(),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (parsed.data.action === 'pairingCode') {
      if (!parsed.data.printerId) return reply({ error: 'INVALID_INPUT' }, 400)
      return reply(
        await createPairingCode(
          ctx.client,
          ctx.active.id,
          parsed.data.printerId,
        ),
      )
    }
    if (!parsed.data.deviceId) return reply({ error: 'INVALID_INPUT' }, 400)
    await revokePrintDevice(ctx.client, ctx.active.id, parsed.data.deviceId)
    return reply({
      devices: (await readPrintDevices(ctx.client, ctx.active.id)) ?? [],
    })
  } catch (e) {
    const code = errorCode(e instanceof Error ? e.message : '')
    return reply({ error: code }, code === 'FORBIDDEN' ? 403 : 400)
  }
}
