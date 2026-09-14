import { ProductHttpError } from '../../extensions/zettle/http'
import { readZettleImageUrl } from './zettle-images'
import { zettleErrorCode } from './zettle'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  connectedPilotCatalog,
  pilotAvailable,
  pilotEnvironment,
  type PilotEnvironment,
} from '../../extensions/zettle/auth'
import {
  catalogProduct,
  ProductReadError,
} from '../../extensions/zettle/catalog'
import {
  InventoryReadError,
  mayInitialize,
  stockOutcome,
  type Stock,
} from '../../extensions/zettle/inventory'

export async function readZettleStock(
  client: SupabaseClient,
  tenantId: string,
) {
  const r = await client.rpc('zettle_stock_status', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (r.error) throw new Error('ZETTLE_READ_FAILED')
  return z
    .array(
      z.object({
        intent_id: z.uuid(),
        item_id: z.uuid(),
        status: z.enum(['initialized', 'depleted', 'unknown', 'conflict']),
        error_code: z.string().nullable(),
        checked_at: z.string().nullable(),
      }),
    )
    .max(50)
    .parse(r.data)
}
/** One accepted item per command. A durable claim, not HTTP retries, controls stock mutation. */
export async function exportZettleItem(
  client: SupabaseClient,
  tenantId: string,
  requestId: string,
  itemId: string,
  source: PilotEnvironment,
  factory = connectedPilotCatalog,
) {
  for (const id of [tenantId, requestId, itemId]) z.uuid().parse(id)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  const connection = await client
    .from('zettle_pull_connections')
    .select('merchant_id')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (
    connection.error ||
    connection.data?.merchant_id !== env.ZETTLE_MERCHANT_ID
  )
    throw new Error('ZETTLE_NOT_CONNECTED')
  const prepare = async () => {
    const r = await client.rpc('prepare_zettle_product', {
      p_tenant: tenantId,
      p_item: itemId,
    })
    if (r.error) throw new Error(r.error.message)
    return z.uuid().parse(r.data)
  }
  let exportId = await prepare()
  const current = async () => {
    if ((await prepare()) !== exportId) throw new Error('ZETTLE_CONFIG_CHANGED')
  }
  const remote = await factory(tenantId, env)
  // Read-only discovery before product creation, so ambiguous inventory roles fail early.
  const locations = await remote.inventory.inventories()
  const load = async () => {
    const stored = await client
      .from('zettle_product_exports')
      .select('payload,previous_payload')
      .eq('tenant_id', tenantId)
      .eq('id', exportId)
      .single()
    if (stored.error) throw new Error('ZETTLE_READ_FAILED')
    return {
      payload: catalogProduct.parse(stored.data.payload),
      previous: stored.data.previous_payload
        ? catalogProduct.parse(stored.data.previous_payload)
        : null,
    }
  }
  let { payload, previous } = await load()
  for (let attempt = 0; attempt < 2; attempt++) {
    await current()
    try {
      const imageUrl = await readZettleImageUrl(client, tenantId, itemId)
      await remote.putProduct(payload, previous, imageUrl ?? undefined)
      break
    } catch (error) {
      const safe = zettleErrorCode(error instanceof Error ? error.message : '')
      const code = safe.startsWith('ZETTLE_') ? safe : 'ZETTLE_EXPORT_FAILED'
      const failed = await client.rpc('finish_zettle_product', {
        p_tenant: tenantId,
        p_export: exportId,
        p_status: 'failed',
        p_error: code,
      })
      if (failed.error) throw new Error('ZETTLE_OUTCOME_FAILED')
      if (code === 'ZETTLE_PRODUCT_UUID_REJECTED' && attempt === 0) {
        const repaired = await client.rpc('repair_zettle_product_identity', {
          p_tenant: tenantId,
          p_export: exportId,
        })
        if (repaired.error) throw new Error(repaired.error.message)
        exportId = z.uuid().parse(repaired.data)
        ;({ payload, previous } = await load())
        continue
      }
      if (
        error instanceof ProductReadError ||
        error instanceof ProductHttpError
      )
        throw error
      throw new Error(code)
    }
  }
  const reserved = await client.rpc('claim_zettle_stock', {
    p_tenant: tenantId,
    p_id: requestId,
    p_export: exportId,
    p_merchant: env.ZETTLE_MERCHANT_ID,
    p_locations: locations,
  })
  if (reserved.error) throw new Error(reserved.error.message)
  const claim = z
    .object({ id: z.uuid(), fresh: z.boolean() })
    .parse(reserved.data)
  const finished = await client.rpc('finish_zettle_product', {
    p_tenant: tenantId,
    p_export: exportId,
    p_status: 'synced',
    p_error: null,
  })
  if (finished.error) throw new Error(finished.error.message)
  const product = payload.uuid,
    variant = payload.variants[0].uuid
  let status: ReturnType<typeof stockOutcome> = 'unknown',
    error: string | null = null
  type StockStep =
    'tracking' | 'enable' | 'before' | 'movement' | 'after' | 'observe'
  let tracking: boolean | undefined
  let step:
    'tracking' | 'enable' | 'before' | 'movement' | 'after' | 'observe' =
    'tracking'
  let observed: Stock | undefined
  let diagnostic:
    | {
        step: StockStep
        tracking?: boolean
        httpStatus?: number
        fields?: string[]
        stock?: Stock
      }
    | undefined
  const detail = (e: unknown) => ({
    step,
    tracking,
    ...(e instanceof InventoryReadError
      ? { httpStatus: e.httpStatus, fields: e.fields }
      : {}),
  })
  try {
    const tracked = await remote.inventory.tracked(product)
    tracking = tracked
    if (!tracked && !claim.fresh) throw new Error('ZETTLE_STOCK_HELD')
    if (!tracked) {
      step = 'enable'
      await remote.inventory.enable(product)
      tracking = true
    }
    step = 'before'
    const before = await remote.inventory.stock(product, variant, locations)
    observed = before
    if (claim.fresh) {
      if (!mayInitialize(before)) {
        // Existing remote stock is not evidence that this invocation initialized it.
        status = 'conflict'
      } else {
        await current()
        // One submission only. A lost response is resolved by observation, never retransmission.
        try {
          step = 'movement'
          await remote.inventory.initialize(
            product,
            variant,
            locations,
            claim.id,
          )
        } catch (e) {
          error = 'ZETTLE_INVENTORY_FAILED'
          diagnostic = detail(e)
        }
        step = 'after'
        observed = await remote.inventory.stock(product, variant, locations)
        status = stockOutcome(observed)
      }
    } else {
      status = stockOutcome(before)
    }
    if (status === 'initialized') error = null
    else error ??= 'ZETTLE_STOCK_HELD'
  } catch (e) {
    error = 'ZETTLE_STOCK_HELD'
    diagnostic = detail(e)
  }
  const outcome = await client.rpc('finish_zettle_stock', {
    p_tenant: tenantId,
    p_intent: claim.id,
    p_status: status,
    p_error: error,
  })
  if (outcome.error) throw new Error('ZETTLE_OUTCOME_FAILED')
  return {
    id: requestId,
    stock: status,
    ...(['unknown', 'conflict'].includes(status)
      ? { diagnostic: diagnostic ?? { step: 'observe', stock: observed } }
      : {}),
  }
}
