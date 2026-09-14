import { ProductHttpError } from '@/extensions/zettle/http'
import { enableAutomation, disableAutomation } from '@/lib/engine/automation'
import { ProductReadError } from '@/extensions/zettle/catalog'
import { exportZettleItem } from '@/lib/engine/zettle-stock'
import { exportZettleImage } from '@/lib/engine/zettle-images'
import {
  enableZettlePull,
  pullZettlePurchases,
  abandonZettleWindow,
} from '@/lib/engine/zettle-live'
import { pilotEnvironment } from '@/extensions/zettle/auth'
import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  zettleCommand,
  zettleErrorCode,
  syncZettle,
  resolveZettleLine,
  configureZettle,
  retryZettleReceipt,
  syncZettleCatalog,
} from '@/lib/engine/zettle'
import {
  localZettleClient,
  zettleFixturesEnabled,
} from '@/extensions/zettle/fixtures'
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
    const parsed = zettleCommand.safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (ctx.active?.id !== c.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    if (
      c.action === 'enableAutomaticPull' ||
      c.action === 'disableAutomaticPull'
    ) {
      if (ctx.active.role !== 'owner') return reply({ error: 'FORBIDDEN' }, 403)
      if (c.action === 'enableAutomaticPull') {
        await enableAutomation(
          ctx.client,
          c.tenantId,
          c.requestId,
          'zettle_pull',
        )
      } else {
        await disableAutomation(ctx.client, c.tenantId, 'zettle_pull')
      }
      return reply({ id: c.requestId })
    }
    if (c.action === 'abandonWindow') {
      if (ctx.active.role !== 'owner') return reply({ error: 'FORBIDDEN' }, 403)
      return reply(
        await abandonZettleWindow(
          ctx.client,
          c.tenantId,
          c.requestId,
          c.windowId,
          c.reason,
        ),
      )
    }
    if (c.action === 'export' || c.action === 'exportImage') {
      if (!['owner', 'admin'].includes(ctx.active.role))
        return reply({ error: 'FORBIDDEN' }, 403)
      return reply(
        await (
          c.action === 'exportImage' ? exportZettleImage : exportZettleItem
        )(
          ctx.client,
          c.tenantId,
          c.requestId,
          c.itemId,
          pilotEnvironment(process.env),
        ),
      )
    }
    if (c.action === 'enablePull' || c.action === 'pull') {
      if (!['owner', 'admin'].includes(ctx.active.role))
        return reply({ error: 'FORBIDDEN' }, 403)
      if (c.action === 'enablePull') {
        const cutover = await enableZettlePull(
          ctx.client,
          c.tenantId,
          pilotEnvironment(process.env),
        )
        return reply({ id: c.requestId, cutover })
      }
      return reply(
        await pullZettlePurchases(
          ctx.client,
          c.tenantId,
          c.requestId,
          pilotEnvironment(process.env),
        ),
      )
    }
    if (c.action === 'sync' && !zettleFixturesEnabled())
      return reply({ error: 'ZETTLE_NOT_CONNECTED' }, 409)
    if (c.action === 'configure') {
      const r = await configureZettle(ctx.client, c)
      return r.error
        ? reply({ error: zettleErrorCode(r.error.message) }, 409)
        : reply({ id: r.data })
    }
    if (c.action === 'retry') {
      const r = await retryZettleReceipt(ctx.client, c)
      return r.error
        ? reply({ error: zettleErrorCode(r.error.message) }, 409)
        : reply({ id: c.requestId })
    }
    const transport = c.action === 'sync' ? localZettleClient(c.tenantId) : null
    const result =
      c.action === 'sync'
        ? await syncZettle(ctx.client, c, transport!)
        : await resolveZettleLine(ctx.client, c)
    if (result.error)
      return reply({ error: zettleErrorCode(result.error.message) }, 409)
    const catalog = transport
      ? await syncZettleCatalog(ctx.client, c.tenantId, transport)
      : []
    return reply({ id: result.data, catalog })
  } catch (e) {
    const code = zettleErrorCode(e instanceof Error ? e.message : '')
    return reply(
      {
        error: code,
        ...(e instanceof ProductReadError ? { fields: e.fields } : {}),
        ...(e instanceof ProductHttpError
          ? { httpStatus: e.httpStatus, fields: e.hints }
          : {}),
      },
      code === 'REQUEST_FAILED' ? 500 : 409,
    )
  }
}
