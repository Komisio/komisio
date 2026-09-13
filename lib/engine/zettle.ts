import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cursor,
  importLine,
  mapZettlePage,
} from '../../extensions/zettle/purchase'
import type { ZettleTransport } from '../../extensions/zettle/transport'
import { catalogProduct } from '../../extensions/zettle/catalog'
import type { ZettleClient } from '../../extensions/zettle/http'
const base = z.strictObject({ tenantId: z.uuid(), requestId: z.uuid() })
export const zettleCommand = z.discriminatedUnion('action', [
  base.extend({ action: z.literal('sync'), previous: cursor }),
  base.extend({
    action: z.literal('resolve'),
    importId: z.uuid(),
    lineNo: z.number().int().min(1).max(50),
    mappingRevision: z.number().int().min(0).max(999999998),
    itemId: z.uuid(),
  }),
  base.extend({
    action: z.literal('configure'),
    previousId: z.uuid().nullable(),
    vatMap: z.partialRecord(
      z.enum([
        'consignment_margin',
        'consignment_full',
        'consignment_business',
        'store_margin',
        'store_full',
      ]),
      z.number().min(0).max(100),
    ),
  }),
  base.extend({ action: z.literal('retry'), importId: z.uuid() }),
  base.extend({ action: z.literal('enablePull') }),
  base.extend({ action: z.literal('pull') }),
  base.extend({ action: z.literal('export'), itemId: z.uuid() }),
])
const receiptRow = z.object({
  id: z.uuid(),
  external_id: z.uuid(),
  occurred_at: z.string(),
  currency: z.string(),
  amount_ore: z.number().int(),
  blocked_reason: z.string().nullable(),
  lines: z.array(importLine).max(50),
  created_at: z.string(),
})
/** Caller supplies the already tenant-bound transport; no service-role credential. */
export async function syncZettle(
  client: SupabaseClient,
  input: unknown,
  transport: ZettleTransport,
) {
  const c = zettleCommand.options[0].parse(input)
  // A lost response reuses the already committed page, not the moving provider page.
  const prior = await client
    .from('zettle_sync_runs')
    .select('cursor_before,cursor_after,page')
    .eq('tenant_id', c.tenantId)
    .eq('id', c.requestId)
    .maybeSingle()
  if (prior.error) throw new Error('ZETTLE_READ_FAILED')
  const page = prior.data
    ? { purchases: prior.data.page, nextCursor: prior.data.cursor_after }
    : mapZettlePage(
        await transport.fetchPage({
          cursor: c.previous,
          signal: AbortSignal.timeout(15000),
        }),
        c.previous,
      )
  return client.rpc('record_zettle_page', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_before: c.previous,
    p_after: page.nextCursor,
    p_purchases: page.purchases,
  })
}
export async function resolveZettleLine(
  client: SupabaseClient,
  input: unknown,
) {
  const c = zettleCommand.options[1].parse(input)
  return client.rpc('resolve_zettle_line', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_import: c.importId,
    p_line: c.lineNo,
    p_expected: c.mappingRevision,
    p_item: c.itemId,
  })
}
export async function readZettlePurchase(
  client: SupabaseClient,
  tenantId: string,
  id: string,
  revision?: number,
) {
  z.uuid().parse(tenantId)
  z.uuid().parse(id)
  const receipt = await client
    .from('zettle_imports')
    .select(
      'id,external_id,occurred_at,currency,amount_ore,blocked_reason,lines,created_at',
    )
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (receipt.error || !receipt.data) throw new Error('ZETTLE_IMPORT_NOT_FOUND')
  const row = receiptRow.parse(receipt.data)
  const [matches, sale, latest, outcome] = await Promise.all([
    client.rpc('zettle_matches', {
      p_tenant: tenantId,
      p_import: id,
      p_revision: revision ?? null,
    }),
    client
      .from('sales')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('provider', 'zettle')
      .eq('external_id', row.external_id)
      .maybeSingle(),
    client
      .from('zettle_line_resolutions')
      .select('revision')
      .eq('tenant_id', tenantId)
      .eq('import_id', id)
      .order('revision', { ascending: false })
      .limit(1),
    client
      .from('zettle_receipt_outcomes')
      .select('error_code')
      .eq('tenant_id', tenantId)
      .eq('import_id', id)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (matches.error || sale.error || latest.error || outcome.error)
    throw new Error('ZETTLE_READ_FAILED')
  const resolutions = z
    .array(
      z.object({
        line_no: z.number().int(),
        item_id: z.uuid(),
        revision: z.number().int(),
      }),
    )
    .max(50)
    .parse(matches.data)
  const currentRevision = latest.data?.[0]?.revision ?? 0
  return {
    ...row,
    mappingRevision: currentRevision,
    saleId: sale.data?.id ?? null,
    errorCode: outcome.data?.[0]?.error_code ?? null,
    rows: row.lines.map((l) => ({
      ...l,
      itemId: resolutions.find((r) => r.line_no === l.lineNo)?.item_id ?? null,
    })),
  }
}
export const zettlePageCursor = z.strictObject({
  before: z.iso.datetime({ offset: true }),
  id: z.uuid(),
})
export async function readZettleStatus(
  client: SupabaseClient,
  tenantId: string,
  pageCursor?: z.infer<typeof zettlePageCursor>,
) {
  z.uuid().parse(tenantId)
  if (pageCursor) zettlePageCursor.parse(pageCursor)
  let query = client
    .from('zettle_imports')
    .select('id,external_id,created_at,blocked_reason,amount_ore,currency')
    .eq('tenant_id', tenantId)
  if (pageCursor)
    query = query.or(
      `created_at.lt.${pageCursor.before},and(created_at.eq.${pageCursor.before},id.lt.${pageCursor.id})`,
    )
  const [runs, imports] = await Promise.all([
    client
      .from('zettle_sync_runs')
      .select('created_at,cursor_after')
      .eq('tenant_id', tenantId)
      .order('seq', { ascending: false })
      .limit(1),
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(51),
  ])
  if (runs.error || imports.error) throw new Error('ZETTLE_READ_FAILED')
  return {
    lastSync: runs.data?.[0]?.created_at ?? null,
    cursor: runs.data?.[0]?.cursor_after ?? null,
    imports: (imports.data ?? []).slice(0, 50),
    next:
      (imports.data?.length ?? 0) > 50
        ? {
            before: imports.data![49].created_at as string,
            id: imports.data![49].id as string,
          }
        : null,
  }
}
export type ZettlePurchase = Awaited<ReturnType<typeof readZettlePurchase>>

export const zettleErrorCodes = [
  'ZETTLE_PRODUCT_UUID_REJECTED',
  'ZETTLE_IDENTITY_HELD',
  'ZETTLE_PRODUCT_ACCESS_DENIED',
  'ZETTLE_PRODUCT_REJECTED',
  'ZETTLE_PRODUCT_RESPONSE_INVALID',
  'ZETTLE_PRODUCT_FIELDS_UNSUPPORTED',
  'ZETTLE_CREATE_FAILED',
  'ZETTLE_UPDATE_FAILED',
  'ZETTLE_READ_FAILED',
  'ZETTLE_RETRY_LATER',
  'ZETTLE_INVENTORY_FAILED',
  'ZETTLE_INVENTORY_CONFLICT',
  'ZETTLE_INVENTORY_AMBIGUOUS',
  'ZETTLE_STOCK_HELD',
  'ZETTLE_EXPORT_FAILED',
  'ZETTLE_NOT_CONNECTED',
  'ZETTLE_AUTH_REQUIRED',
  'ZETTLE_CONNECTION_FAILED',
  'ZETTLE_WINDOW_INVALID',
  'ZETTLE_WINDOW_COMPLETE',
  'ZETTLE_VAT_MAPPING_REQUIRED',
  'ZETTLE_CONFIG_CHANGED',
  'ZETTLE_REMOTE_CHANGED',
  'ZETTLE_REMOTE_MISSING',
  'ZETTLE_WRONG_MERCHANT',
  'ZETTLE_RATE_LIMITED',
  'ZETTLE_CURSOR_CHANGED',
  'ZETTLE_PURCHASE_CONFLICT',
  'ZETTLE_MATCH_CHANGED',
  'ZETTLE_ALREADY_RECORDED',
  'ZETTLE_UNMATCHED_LINES',
  'ZETTLE_UNSUPPORTED_PURCHASE',
  'ITEM_NOT_FOUND',
  'ITEM_ALREADY_SOLD',
  'VAT_MODE_NOT_SET',
  'INVALID_INPUT',
  'REQUEST_CONFLICT',
  'FORBIDDEN',
  'AUTH_REQUIRED',
] as const
export function zettleErrorCode(message: string) {
  return zettleErrorCodes.find((code) => message === code) ?? 'REQUEST_FAILED'
}

export async function configureZettle(client: SupabaseClient, input: unknown) {
  const c = zettleCommand.options[2].parse(input)
  return client.rpc('publish_zettle_catalog_config', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_previous: c.previousId,
    p_map: c.vatMap,
  })
}
export async function readZettleCatalog(
  client: SupabaseClient,
  tenantId: string,
) {
  z.uuid().parse(tenantId)
  const [config, candidates, outcomes] = await Promise.all([
    client
      .from('zettle_catalog_configs')
      .select('id,vat_map')
      .eq('tenant_id', tenantId)
      .order('revision', { ascending: false })
      .limit(1),
    client.rpc('zettle_catalog_candidates', { p_tenant: tenantId }),
    client
      .from('zettle_product_outcomes')
      .select('export_id,status,error_code,created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(30),
  ])
  if (config.error || candidates.error || outcomes.error)
    throw new Error('ZETTLE_READ_FAILED')
  return {
    config: config.data?.[0] ?? null,
    candidates: z
      .array(z.object({ item_id: z.uuid() }))
      .max(20)
      .parse(candidates.data),
    outcomes: outcomes.data ?? [],
  }
}
/** Engine snapshots accepted state; adapter sends only that snapshot. No AI proposal. */
export async function syncZettleCatalog(
  client: SupabaseClient,
  tenantId: string,
  transport: ZettleClient,
) {
  const state = await readZettleCatalog(client, tenantId)
  if (!state.config) return [{ error: 'ZETTLE_VAT_MAPPING_REQUIRED' }]
  const results: { itemId?: string; error?: string }[] = []
  // Bounded synchronous pass; remaining candidates are retried by the next sync.
  for (const { item_id: itemId } of state.candidates.slice(0, 5)) {
    let exportId: string | undefined
    try {
      const prepared = await client.rpc('prepare_zettle_product', {
        p_tenant: tenantId,
        p_item: itemId,
      })
      if (prepared.error) throw new Error(prepared.error.message)
      exportId = z.uuid().parse(prepared.data)
      const stored = await client
        .from('zettle_product_exports')
        .select('payload,previous_payload')
        .eq('tenant_id', tenantId)
        .eq('id', exportId)
        .single()
      if (stored.error) throw new Error('ZETTLE_READ_FAILED')
      const payload = catalogProduct.parse(stored.data.payload),
        previous = stored.data.previous_payload
          ? catalogProduct.parse(stored.data.previous_payload)
          : null
      await transport.putProduct(payload, previous)
      const finished = await client.rpc('finish_zettle_product', {
        p_tenant: tenantId,
        p_export: exportId,
        p_status: 'synced',
        p_error: null,
      })
      if (finished.error) throw new Error(finished.error.message)
      results.push({ itemId })
    } catch (e) {
      const code =
        e instanceof Error && /^ZETTLE_[A-Z_]{1,80}$/.test(e.message)
          ? e.message
          : 'ZETTLE_EXPORT_FAILED'
      if (exportId) {
        const recorded = await client.rpc('finish_zettle_product', {
          p_tenant: tenantId,
          p_export: exportId,
          p_status: 'failed',
          p_error: code,
        })
        if (recorded.error) throw new Error('ZETTLE_OUTCOME_FAILED')
      }
      results.push({ itemId, error: code })
    }
  }
  return results
}

export async function retryZettleReceipt(
  client: SupabaseClient,
  input: unknown,
) {
  const c = zettleCommand.options[3].parse(input)
  return client.rpc('reconcile_zettle_receipt', {
    p_tenant: c.tenantId,
    p_import: c.importId,
  })
}
