import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import {
  sendSellerCommunicationCommand,
  referenceKindFor,
} from '@/lib/engine/communications'
import { renderSellerMessage } from '@/lib/communications/templates'
import { sendSellerEmailWithId } from '@/lib/platform/seller-email'
import { formatSignedOre } from '@/lib/engine/seller-ledger'

const ore = z.union([z.number().int(), z.string()]).transform(Number)

/** Queue, send and record one seller message. SQL authorizes and binds the facts. */
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
  if (Number(request.headers.get('content-length') ?? 0) > 16000)
    return reply({ error: 'INVALID_INPUT' }, 413)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const parsed = sendSellerCommunicationCommand.safeParse(
      await request.json(),
    )
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (c.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
    const client = ctx.client
    const seller = await client
      .from('sellers')
      .select('name,email')
      .eq('tenant_id', c.tenantId)
      .eq('id', c.sellerId)
      .maybeSingle()
    if (seller.error || !seller.data)
      return reply({ error: 'SELLER_NOT_FOUND' }, 400)
    const locale = ctx.locale
    const when = (iso: string) =>
      new Date(iso).toLocaleDateString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
        timeZone: 'Europe/Stockholm',
      })
    // Facts for the template come from authenticated reads of the referenced row.
    const facts: Record<string, unknown> = {
      storeName: ctx.active.name,
      sellerName: seller.data.name,
      freeText: c.freeText,
    }
    if (c.kind === 'item_accepted' && c.referenceId) {
      const price = await client
        .from('item_prices')
        .select('price_ore')
        .eq('tenant_id', c.tenantId)
        .eq('item_id', c.referenceId)
        .order('set_at')
        .limit(1)
        .maybeSingle()
      if (price.data)
        facts.amount = formatSignedOre(ore.parse(price.data.price_ore))
    } else if (c.kind === 'item_sold' && c.referenceId) {
      const line = await client
        .from('sale_lines')
        .select('seller_credit_ore,sale_id')
        .eq('tenant_id', c.tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (line.data) {
        facts.amount = formatSignedOre(ore.parse(line.data.seller_credit_ore))
        const sale = await client
          .from('sales')
          .select('occurred_at')
          .eq('tenant_id', c.tenantId)
          .eq('id', line.data.sale_id)
          .maybeSingle()
        if (sale.data) facts.date = when(sale.data.occurred_at)
      }
    } else if (
      (c.kind === 'payout_approved' || c.kind === 'payout_paid') &&
      c.referenceId
    ) {
      const payout = await client
        .from('payouts')
        .select('amount_ore,paid_at')
        .eq('tenant_id', c.tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (payout.data) {
        facts.amount = formatSignedOre(ore.parse(payout.data.amount_ore))
        if (payout.data.paid_at) facts.date = when(payout.data.paid_at)
      }
    } else if (c.kind === 'statement_issued' && c.referenceId) {
      const statement = await client
        .from('settlement_statements')
        .select('number,closing_ore')
        .eq('tenant_id', c.tenantId)
        .eq('id', c.referenceId)
        .maybeSingle()
      if (statement.data) {
        facts.number = statement.data.number
        facts.amount = formatSignedOre(ore.parse(statement.data.closing_ore))
      }
    }
    const rendered = renderSellerMessage(c.kind, locale, facts)
    const queued = await client.rpc('queue_seller_communication', {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_seller: c.sellerId,
      p_kind: c.kind,
      p_template_key: rendered.templateKey,
      p_template_version: rendered.templateVersion,
      p_locale: locale,
      p_subject: rendered.subject,
      p_body: rendered.body,
      p_reference_kind: referenceKindFor[c.kind],
      p_reference_id: c.referenceId,
    })
    if (queued.error) {
      const code =
        [
          'FORBIDDEN',
          'AUTH_REQUIRED',
          'REQUEST_CONFLICT',
          'SELLER_NOT_FOUND',
          'SELLER_EMAIL_MISSING',
          'REFERENCE_NOT_FOUND',
          'INVALID_INPUT',
        ].find((v) => queued.error!.message.includes(v)) ?? 'REQUEST_FAILED'
      return reply(
        { error: code },
        code === 'FORBIDDEN' ? 403 : code === 'REQUEST_CONFLICT' ? 409 : 400,
      )
    }
    // Already delivered on an earlier attempt: report the stored outcome, never send twice.
    const existing = await client
      .from('seller_communications')
      .select('status,recipient,subject,body')
      .eq('tenant_id', c.tenantId)
      .eq('id', c.requestId)
      .single()
    if (existing.error) return reply({ error: 'REQUEST_FAILED' }, 500)
    if (existing.data.status !== 'queued')
      return reply({
        ok: true,
        id: c.requestId,
        delivery: existing.data.status,
      })
    const outcome = await sendSellerEmailWithId({
      communicationId: c.requestId,
      to: existing.data.recipient,
      subject: existing.data.subject,
      text: existing.data.body,
    })
    const recorded = await client.rpc('record_communication_delivery', {
      p_tenant: c.tenantId,
      p_id: c.requestId,
      p_status: outcome.status,
      p_provider_message_id: outcome.providerMessageId,
    })
    if (recorded.error) return reply({ error: 'REQUEST_FAILED' }, 500)
    return reply({ ok: true, id: c.requestId, delivery: outcome.status })
  } catch {
    // Never log bodies, addresses or provider responses.
    console.error('Communication request failed', { requestId })
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
