import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

// Settlement statements (P2 S16): numbered, frozen documents computed from
// the seller ledger for a period. A correction is a credit note that
// references the original. Boundary validation only.
export const issueStatementCommand = z
  .strictObject({
    action: z.literal('issueStatement'),
    tenantId: z.uuid(),
    requestId: z.uuid(),
    sellerId: z.uuid(),
    periodFrom: z.iso.datetime({ offset: true }),
    periodTo: z.iso.datetime({ offset: true }),
    correctsId: z.uuid().nullable().default(null),
  })
  .refine(
    (v) => Date.parse(v.periodTo) > Date.parse(v.periodFrom),
    'Empty period',
  )

const ore = z.union([z.number().int(), z.string()]).transform(Number)
const statementRow = z.object({
  id: z.uuid(),
  seller_id: z.uuid(),
  number: z.number().int(),
  kind: z.enum(['statement', 'credit_note']),
  corrects_id: z.uuid().nullable(),
  period_from: z.iso.datetime({ offset: true }),
  period_to: z.iso.datetime({ offset: true }),
  opening_ore: ore,
  sales_gross_ore: ore,
  commission_ore: ore,
  credited_ore: ore,
  reversed_ore: ore,
  paid_ore: ore,
  adjustments_ore: ore,
  closing_ore: ore,
  issued_at: z.iso.datetime({ offset: true }),
})
export type StatementRow = z.infer<typeof statementRow>
const lineRow = z.object({
  id: z.uuid(),
  line_no: z.number().int(),
  kind: z.string(),
  amount_ore: ore,
  occurred_at: z.iso.datetime({ offset: true }),
  reference_kind: z.string(),
  reference_id: z.uuid(),
  sale_price_ore: ore.nullable(),
  commission_ore: ore.nullable(),
})
const columns =
  'id,seller_id,number,kind,corrects_id,period_from,period_to,opening_ore,sales_gross_ore,commission_ore,credited_ore,reversed_ore,paid_ore,adjustments_ore,closing_ore,issued_at'

/** Newest 50 statements for one seller. RLS scopes the read. */
export async function readSellerStatements(
  client: SupabaseClient,
  tenantInput: string,
  sellerInput: string,
) {
  const { data, error } = await client
    .from('settlement_statements')
    .select(columns)
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .eq('seller_id', z.uuid().parse(sellerInput))
    .order('number', { ascending: false })
    .limit(50)
  if (error) throw new Error('Unable to read statements')
  return z.array(statementRow).parse(data)
}

/** One statement with its lines, or null. */
export async function readStatement(
  client: SupabaseClient,
  tenantInput: string,
  statementInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput),
    statementId = z.uuid().parse(statementInput)
  const head = await client
    .from('settlement_statements')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('id', statementId)
    .maybeSingle()
  if (head.error) throw new Error('Unable to read statement')
  if (!head.data) return null
  const lines = await client
    .from('settlement_statement_lines')
    .select(
      'id,line_no,kind,amount_ore,occurred_at,reference_kind,reference_id,sale_price_ore,commission_ore',
    )
    .eq('tenant_id', tenantId)
    .eq('statement_id', statementId)
    .order('line_no')
  if (lines.error) throw new Error('Unable to read statement')
  return {
    statement: statementRow.parse(head.data),
    lines: z.array(lineRow).parse(lines.data),
  }
}
