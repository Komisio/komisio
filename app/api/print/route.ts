import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import {
  queuePrintJobInput,
  readLabelFormats,
  readLabelTemplates,
} from '@/lib/engine/printing'
import {
  LABEL_TEMPLATE_VERSION,
  referenceFormat,
  renderLabel,
} from '@/lib/labels/templates'
import { renderStoreTemplate } from '@/lib/labels/placeholders'
import { readStoreCurrency } from '@/lib/engine/money'
import { formatOre } from '@/lib/engine/items'

const ore = z.union([z.number().int(), z.string()]).transform(Number)

/** Render a label from the referenced fact and queue it for a printer. */
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
  if (Number(request.headers.get('content-length') ?? 0) > 4000)
    return reply({ error: 'INVALID_INPUT' }, 413)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const parsed = queuePrintJobInput.safeParse(await request.json())
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (c.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
    const client = ctx.client,
      tenantId = c.tenantId
    const day = (iso: string) =>
      new Date(iso).toLocaleDateString('sv-SE', {
        timeZone: 'Europe/Stockholm',
      })
    const facts: Record<string, unknown> = {
      storeName: ctx.active.name,
      reference: '',
      currency: await readStoreCurrency(client, tenantId),
    }
    if (c.referenceKind === 'bag_receipt') {
      const bag = await client
        .from('bag_receipts')
        .select('reference,received_at')
        .eq('tenant_id', tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (!bag.data) return reply({ error: 'REFERENCE_NOT_FOUND' }, 400)
      facts.reference = `K-${bag.data.reference}`
      facts.date = day(bag.data.received_at)
    } else if (c.referenceKind === 'garment_receipt') {
      const garment = await client
        .from('garment_receipts')
        .select('reference,received_at')
        .eq('tenant_id', tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (!garment.data) return reply({ error: 'REFERENCE_NOT_FOUND' }, 400)
      facts.reference = `G-${garment.data.reference}`
      facts.date = day(garment.data.received_at)
    } else if (c.referenceKind === 'item') {
      const item = await client
        .from('items')
        .select('id,origin_kind,terms')
        .eq('tenant_id', tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (!item.data) return reply({ error: 'REFERENCE_NOT_FOUND' }, 400)
      const prices = await client
        .from('item_prices')
        .select('price_ore,set_at')
        .eq('tenant_id', tenantId)
        .eq('item_id', c.referenceId)
        .order('set_at', { ascending: false })
        .order('seq', { ascending: false })
        .limit(2)
      const list = z
        .array(z.object({ price_ore: ore }))
        .parse(prices.data ?? [])
      facts.reference = `I-${item.data.id.slice(0, 8).toUpperCase()}`
      facts.price = list[0] ? formatOre(list[0].price_ore) : undefined
      if (c.kind === 'markdown' && list[1])
        facts.oldPrice = formatOre(list[1].price_ore)
      const origin = (item.data.terms as { origin?: Record<string, unknown> })
        .origin
      facts.line1 =
        origin && typeof origin.garmentReference === 'number'
          ? `G-${origin.garmentReference}`
          : origin && typeof origin.bagReference === 'number'
            ? `K-${origin.bagReference}`
            : ''
      facts.line2 = ''
    } else {
      const seller = await client
        .from('sellers')
        .select('id,name')
        .eq('tenant_id', tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (!seller.data) return reply({ error: 'REFERENCE_NOT_FOUND' }, 400)
      facts.reference = `S-${seller.data.id.slice(0, 8).toUpperCase()}`
      facts.line1 = seller.data.name
      facts.qr = `${origin}/intake/sellers/${seller.data.id}`
    }
    const printer = await client
      .from('printers')
      .select('dpi')
      .eq('tenant_id', tenantId)
      .eq('id', c.printerId)
      .maybeSingle()
    if (!printer.data) return reply({ error: 'PRINTER_NOT_FOUND' }, 400)
    const [formats, templates] = await Promise.all([
      readLabelFormats(client, tenantId),
      readLabelTemplates(client, tenantId),
    ])
    const size = formats?.[c.kind] ?? referenceFormat
    const format = {
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      dpi: printer.data.dpi,
    }
    const template = templates?.[c.kind] ?? null
    const payload = template
      ? renderStoreTemplate(template.zpl, facts, format)
      : renderLabel(c.kind, facts, format)
    const templateVersion = template
      ? `store-v${template.version}`
      : LABEL_TEMPLATE_VERSION
    const queued = await client.rpc('queue_print_job', {
      p_tenant: tenantId,
      p_id: c.requestId,
      p_printer: c.printerId,
      p_kind: c.kind,
      p_template_version: templateVersion,
      p_reference_kind: c.referenceKind,
      p_reference_id: c.referenceId,
      p_payload: payload,
      p_copies: c.copies,
    })
    if (queued.error) {
      const code =
        [
          'FORBIDDEN',
          'AUTH_REQUIRED',
          'REQUEST_CONFLICT',
          'PRINTER_NOT_FOUND',
          'PRINTER_INACTIVE',
          'REFERENCE_NOT_FOUND',
          'INVALID_INPUT',
        ].find((v) => queued.error!.message.includes(v)) ?? 'REQUEST_FAILED'
      return reply(
        { error: code },
        code === 'FORBIDDEN' ? 403 : code === 'REQUEST_CONFLICT' ? 409 : 400,
      )
    }
    return reply({ ok: true, id: c.requestId })
  } catch {
    console.error('Print request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
