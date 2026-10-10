import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

const identity = { tenantId: z.uuid(), requestId: z.uuid() }
export const startStocktakeCommand = z.strictObject({
  ...identity,
  action: z.literal('startStocktake'),
})
export const scanStocktakeCommand = z.strictObject({
  ...identity,
  action: z.literal('scanStocktake'),
  sessionId: z.uuid(),
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(?:I-?[0-9A-F]{8}|[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12})$/),
})
export const recordStocktakeFindingCommand = z.strictObject({
  ...identity,
  action: z.literal('recordStocktakeFinding'),
  sessionId: z.uuid(),
  itemId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  observation: z.enum(['found', 'missing', 'damaged']),
  reason: z.string().trim().min(1).max(500),
})
export const finishStocktakeCommand = z.strictObject({
  ...identity,
  action: z.literal('finishStocktake'),
  sessionId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
})
const session = z.object({
  id: z.uuid(),
  at: z.string(),
  actor: z.string(),
  closed: z.boolean(),
})
export const stocktakeRow = z.object({
  id: z.uuid(),
  title: z.string(),
  expected: z.boolean(),
  changed: z.boolean(),
  observation: z.enum(['unchecked', 'found', 'missing', 'damaged']),
  version: z.number().int().nonnegative(),
  reason: z.string(),
  actor: z.string(),
  at: z.string().nullable(),
})
export const stocktakeReport = z.object({
  id: z.uuid(),
  closed: z.boolean(),
  version: z.number().int().nonnegative(),
  counts: z.object({
    total: z.number().int().nonnegative(),
    unchecked: z.number().int().nonnegative(),
    deviations: z.number().int().nonnegative(),
  }),
  matching: z.number().int().nonnegative(),
  rows: z.array(stocktakeRow).max(50),
  history: z
    .array(
      z.object({
        seq: z.number().int(),
        kind: z.enum(['scan', 'finding', 'closed']),
        observation: z.enum(['found', 'missing', 'damaged']).nullable(),
        reason: z.string(),
        item_id: z.uuid().nullable(),
        actor: z.string(),
        at: z.string(),
      }),
    )
    .max(20),
})
export type StocktakeReport = z.infer<typeof stocktakeReport>
export const stocktakeFilter = z.enum(['all', 'unchecked', 'deviations'])
export async function readStocktakeSessions(
  client: SupabaseClient,
  tenant: string,
) {
  const result = await client.rpc('stocktake_sessions_page', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (result.error) throw new Error('Unable to read stocktake sessions')
  return z.array(session).max(20).parse(result.data)
}
export async function readStocktake(
  client: SupabaseClient,
  tenant: string,
  id: string,
  filter: z.infer<typeof stocktakeFilter>,
  offset: number,
) {
  const result = await client.rpc('stocktake_report', {
    p_tenant: z.uuid().parse(tenant),
    p_session: z.uuid().parse(id),
    p_filter: stocktakeFilter.parse(filter),
    p_offset: z.number().int().min(0).max(1000000).parse(offset),
  })
  if (result.error?.message === 'STOCKTAKE_NOT_FOUND') return null
  if (result.error) throw new Error('Unable to read stocktake')
  return stocktakeReport.parse(result.data)
}
