import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { renderSellerMessage, type CommunicationKind } from './templates'
import { referenceKindFor } from '../engine/communications'
import { sendSellerEmailWithId } from '../platform/seller-email'
import { formatSignedOre } from '../engine/seller-ledger'

// One path for every seller message (P2 S18): render the versioned template
// from authenticated reads of the referenced fact, queue the exact text in
// SQL, send through the transport, record the outcome. Staff sends and
// automatic notifications share it; the automatic ones differ only in who
// asked and in a request id derived from the fact, so a fact notifies once.
const ore = z.union([z.number().int(), z.string()]).transform(Number)
export type Locale = 'sv' | 'en'
export const communicationErrorCodes = [
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'REQUEST_CONFLICT',
  'SELLER_NOT_FOUND',
  'SELLER_EMAIL_MISSING',
  'REFERENCE_NOT_FOUND',
  'INVALID_INPUT',
] as const
export type CommunicationError =
  (typeof communicationErrorCodes)[number] | 'REQUEST_FAILED'

/** Deterministic id for the one automatic message a fact may produce (UUID v5 shape). */
export function factCommunicationId(
  kind: CommunicationKind,
  referenceId: string,
) {
  const hex = createHash('sha1')
    .update(`komisio:communication:${kind}:${referenceId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 32)
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

export interface SendInput {
  tenantId: string
  storeName: string
  locale: Locale
  requestId: string
  sellerId: string
  kind: CommunicationKind
  referenceId: string | null
  freeText: string
}

export async function sendSellerCommunication(
  client: SupabaseClient,
  c: SendInput,
): Promise<
  | { ok: true; id: string; delivery: string }
  | { ok: false; error: CommunicationError }
> {
  const seller = await client
    .from('sellers')
    .select('name,email')
    .eq('tenant_id', c.tenantId)
    .eq('id', c.sellerId)
    .maybeSingle()
  if (seller.error || !seller.data)
    return { ok: false, error: 'SELLER_NOT_FOUND' }
  const when = (iso: string) =>
    new Date(iso).toLocaleDateString(c.locale === 'sv' ? 'sv-SE' : 'en-GB', {
      timeZone: 'Europe/Stockholm',
    })
  // Facts for the template come from authenticated reads of the referenced row.
  const facts: Record<string, unknown> = {
    storeName: c.storeName,
    sellerName: seller.data.name,
    freeText: c.freeText,
  }
  if (c.kind === 'item_accepted' && c.referenceId) {
    const price = await client
      .from('item_prices')
      .select('price_ore')
      .eq('tenant_id', c.tenantId)
      .eq('item_id', c.referenceId)
      .order('seq')
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
  const rendered = renderSellerMessage(c.kind, c.locale, facts)
  const queued = await client.rpc('queue_seller_communication', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_seller: c.sellerId,
    p_kind: c.kind,
    p_template_key: rendered.templateKey,
    p_template_version: rendered.templateVersion,
    p_locale: c.locale,
    p_subject: rendered.subject,
    p_body: rendered.body,
    p_reference_kind: referenceKindFor[c.kind],
    p_reference_id: c.referenceId,
  })
  if (queued.error)
    return {
      ok: false,
      error:
        communicationErrorCodes.find((v) =>
          queued.error!.message.includes(v),
        ) ?? 'REQUEST_FAILED',
    }
  // Already delivered on an earlier attempt: report the stored outcome, never send twice.
  const existing = await client
    .from('seller_communications')
    .select('status,recipient,subject,body')
    .eq('tenant_id', c.tenantId)
    .eq('id', c.requestId)
    .single()
  if (existing.error) return { ok: false, error: 'REQUEST_FAILED' }
  if (existing.data.status !== 'queued')
    return { ok: true, id: c.requestId, delivery: existing.data.status }
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
  if (recorded.error) return { ok: false, error: 'REQUEST_FAILED' }
  return { ok: true, id: c.requestId, delivery: outcome.status }
}

export type FactNotification = {
  kind: Exclude<CommunicationKind, 'message'>
  referenceId: string
}

/** The notifications an executed intake command implies; pure except for sale lines. */
export async function notificationsForIntake(
  client: SupabaseClient,
  command: { action: string; tenantId: string; requestId: string } & Record<
    string,
    unknown
  >,
): Promise<FactNotification[]> {
  switch (command.action) {
    case 'acceptItem':
      return [{ kind: 'item_accepted', referenceId: command.requestId }]
    case 'approvePayout':
      return [
        { kind: 'payout_approved', referenceId: String(command.payoutId) },
      ]
    case 'markPayoutPaid':
      return [{ kind: 'payout_paid', referenceId: String(command.payoutId) }]
    case 'issueStatement':
      return [{ kind: 'statement_issued', referenceId: command.requestId }]
    case 'recordSale': {
      const lines = await client
        .from('sale_lines')
        .select('id')
        .eq('tenant_id', command.tenantId)
        .eq('sale_id', command.requestId)
      return z
        .array(z.object({ id: z.uuid() }))
        .parse(lines.data ?? [])
        .map((l) => ({ kind: 'item_sold' as const, referenceId: l.id }))
    }
    default:
      return []
  }
}

/** The notification an executed staged operation implies. */
export function notificationForOperation(
  kind: string,
  operationId: string,
  payload: unknown,
): FactNotification | null {
  const payoutId = (payload as { payoutId?: string } | null)?.payoutId
  if (kind === 'acceptItem')
    return { kind: 'item_accepted', referenceId: operationId }
  if (kind === 'approvePayout' && payoutId)
    return { kind: 'payout_approved', referenceId: payoutId }
  if (kind === 'markPayoutPaid' && payoutId)
    return { kind: 'payout_paid', referenceId: payoutId }
  return null
}

/** Resolves the seller behind a fact; null when the fact has no seller (store-owned item). */
async function sellerForFact(
  client: SupabaseClient,
  tenantId: string,
  n: FactNotification,
) {
  const referenceKind = referenceKindFor[n.kind]
  const seller = z.object({ seller_id: z.uuid().nullable() })
  if (referenceKind === 'item') {
    const r = await client
      .from('items')
      .select('seller_id')
      .eq('tenant_id', tenantId)
      .eq('id', n.referenceId)
      .maybeSingle()
    return r.data ? seller.parse(r.data).seller_id : null
  }
  if (referenceKind === 'sale_line') {
    const r = await client
      .from('sale_lines')
      .select('item_id')
      .eq('tenant_id', tenantId)
      .eq('id', n.referenceId)
      .maybeSingle()
    if (!r.data) return null
    const item = await client
      .from('items')
      .select('seller_id')
      .eq('tenant_id', tenantId)
      .eq('id', z.uuid().parse(r.data.item_id))
      .maybeSingle()
    return item.data ? seller.parse(item.data).seller_id : null
  }
  if (referenceKind === 'payout') {
    const r = await client
      .from('payouts')
      .select('seller_id')
      .eq('tenant_id', tenantId)
      .eq('id', n.referenceId)
      .maybeSingle()
    return r.data ? seller.parse(r.data).seller_id : null
  }
  if (referenceKind === 'statement') {
    const r = await client
      .from('settlement_statements')
      .select('seller_id')
      .eq('tenant_id', tenantId)
      .eq('id', n.referenceId)
      .maybeSingle()
    return r.data ? seller.parse(r.data).seller_id : null
  }
  return null
}

export type NotifyOutcome =
  | {
      kind: CommunicationKind
      referenceId: string
      status: 'skipped'
      why: string
    }
  | {
      kind: CommunicationKind
      referenceId: string
      status: 'notified'
      delivery: string
    }

/** Automatic notifications after facts. Never throws; the fact is already committed. */
export async function notifyAfterFacts(
  client: SupabaseClient,
  store: {
    tenantId: string
    storeName: string
    locale: Locale
    policy: { automaticSellerNotifications?: boolean }
  },
  facts: FactNotification[],
): Promise<NotifyOutcome[]> {
  const outcomes: NotifyOutcome[] = []
  if (store.policy.automaticSellerNotifications !== true)
    return facts.map((n) => ({ ...n, status: 'skipped', why: 'policy' }))
  for (const n of facts) {
    try {
      const sellerId = await sellerForFact(client, store.tenantId, n)
      if (!sellerId) {
        outcomes.push({ ...n, status: 'skipped', why: 'no_seller' })
        continue
      }
      const sent = await sendSellerCommunication(client, {
        tenantId: store.tenantId,
        storeName: store.storeName,
        locale: store.locale,
        requestId: factCommunicationId(n.kind, n.referenceId),
        sellerId,
        kind: n.kind,
        referenceId: n.referenceId,
        freeText: '',
      })
      // A conflict means another person's session already notified this fact.
      outcomes.push(
        sent.ok
          ? { ...n, status: 'notified', delivery: sent.delivery }
          : { ...n, status: 'skipped', why: sent.error },
      )
    } catch {
      outcomes.push({ ...n, status: 'skipped', why: 'REQUEST_FAILED' })
    }
  }
  return outcomes
}
