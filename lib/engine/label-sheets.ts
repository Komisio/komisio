import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { itemLabel } from './item-label'

export const labelSheetQuery = z
  .object({
    tenant: z.uuid(),
    bag: z.uuid().optional(),
    items: z.string().max(7400).optional(),
    size: z.enum(['50x50', '57x32']).default('50x50'),
    copies: z.coerce.number().int().min(1).max(10).default(1),
    download: z.enum(['1']).optional(),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.bag) === Boolean(v.items))
      ctx.addIssue({ code: 'custom', message: 'Choose one source' })
    if (
      v.items &&
      !z.array(z.uuid()).min(1).max(200).safeParse(v.items.split(',')).success
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid item selection' })
  })
export type LabelSheetQuery = z.infer<typeof labelSheetQuery>
export async function readLabelSheet(
  client: SupabaseClient,
  query: LabelSheetQuery,
) {
  const { data, error } = await client.rpc('item_label_sheet_facts', {
    p_tenant: query.tenant,
    p_bag: query.bag ?? null,
    p_items: query.items?.split(',') ?? null,
  })
  if (error) throw new Error('Unable to read label sheet')
  return z
    .object({
      items: z.array(itemLabel).max(200),
      skipped: z.number().int().nonnegative(),
    })
    .parse(data)
}
