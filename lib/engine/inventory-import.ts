import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { currencyCode, readStoreCurrency } from './money'

export const inventoryColumns = [
  'reference',
  'sellerId',
  'email',
  'description',
  'price',
  'currency',
] as const
const cell = z.string().max(2000)
export const inventoryFile = z
  .strictObject({
    source: z.string().trim().min(1).max(200),
    rows: z
      .array(
        z.strictObject({
          line: z.number().int().min(2).max(10000),
          reference: cell,
          sellerId: cell,
          email: cell,
          description: cell,
          price: cell,
          currency: cell,
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (file) =>
      new Set(file.rows.map((row) => row.line)).size === file.rows.length,
  )
export type InventoryFile = z.infer<typeof inventoryFile>
export const inventoryIssues = [
  'reference',
  'duplicate',
  'description',
  'price',
  'currency',
  'sellerReference',
  'missing',
  'ambiguous',
  'conflict',
] as const
type Issue = (typeof inventoryIssues)[number]
const match = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('matched'),
    id: z.uuid(),
    name: z.string().max(120),
  }),
  z.strictObject({ status: z.enum(['missing', 'ambiguous', 'conflict']) }),
])
export const inventoryPreview = z.strictObject({
  currency: currencyCode,
  context: z.string().regex(/^[a-f0-9]{32}$/),
  rows: z
    .array(
      z.strictObject({
        line: z.number().int(),
        seller: match.nullable(),
        priceOre: z.number().int().positive().max(99999999).nullable(),
        issues: z.array(z.enum(inventoryIssues)),
      }),
    )
    .max(200),
})
export type InventoryPreview = z.infer<typeof inventoryPreview>

/** Strict CSV parsing: no silently closed quotes, dropped rows or guessed column mappings. */
export function parseInventoryFile(
  text: string,
  source: string,
): InventoryFile {
  if (text.length > 500000) throw new Error('FILE_TOO_LARGE')
  const body = text.replace(/^\uFEFF/, '')
  const first = body.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = first.includes(';') ? ';' : ','
  const parsed: { line: number; cells: string[] }[] = []
  let cells: string[] = [],
    value = '',
    state: 'plain' | 'quoted' | 'closed' = 'plain',
    line = 1,
    start = 1
  const finish = () => {
    cells.push(value)
    if (cells.some((v) => v.trim() !== '')) parsed.push({ line: start, cells })
    cells = []
    value = ''
    state = 'plain'
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (state === 'quoted') {
      if (c === '"') {
        if (body[i + 1] === '"') {
          value += '"'
          i++
        } else state = 'closed'
      } else {
        value += c
        if (c === '\n') line++
      }
    } else if (c === delimiter) {
      cells.push(value)
      value = ''
      state = 'plain'
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++
      finish()
      line++
      start = line
    } else if (c === '"' && state === 'plain' && value === '') state = 'quoted'
    else if (c === '"' || state === 'closed') throw new Error('INVALID_CSV')
    else value += c
  }
  if (state === 'quoted') throw new Error('INVALID_CSV')
  finish()
  const header = parsed.shift()?.cells.map((c) => c.trim()) ?? []
  if (
    header.length !== inventoryColumns.length ||
    new Set(header).size !== header.length ||
    inventoryColumns.some((c) => !header.includes(c))
  )
    throw new Error('INVALID_HEADER')
  if (parsed.length > 200) throw new Error('TOO_MANY_ROWS')
  if (!parsed.length) throw new Error('EMPTY_FILE')
  const rows = parsed.map(({ line, cells }) => {
    if (cells.length !== header.length) throw new Error('INVALID_CSV')
    return {
      line,
      ...Object.fromEntries(
        inventoryColumns.map((c) => [c, cells[header.indexOf(c)].trim()]),
      ),
    }
  })
  const result = inventoryFile.safeParse({ source, rows })
  if (!result.success) throw new Error('INVALID_CSV')
  return result.data
}

/** Accept decimal comma OR dot, never thousands separators, exponents or currency guessing. */
export function inventoryPrice(value: string): number | null {
  if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split(/[.,]/)
  const ore = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return ore > 0n && ore <= 99999999n ? Number(ore) : null
}

export function inspectInventoryRows(file: InventoryFile, currency: string) {
  const counts = new Map<string, number>()
  file.rows.forEach((row) =>
    counts.set(
      row.reference.trim(),
      (counts.get(row.reference.trim()) ?? 0) + 1,
    ),
  )
  return file.rows.map((row) => {
    const issues: Issue[] = []
    const reference = row.reference.trim(),
      sellerId = row.sellerId.trim(),
      email = row.email.trim().toLowerCase()
    if (!reference || reference.length > 120) issues.push('reference')
    if (reference && counts.get(reference)! > 1) issues.push('duplicate')
    if (row.description.length > 1000) issues.push('description')
    const priceOre = inventoryPrice(row.price.trim())
    if (priceOre === null) issues.push('price')
    if (row.currency.trim().toUpperCase() !== currency) issues.push('currency')
    const validSeller =
      (sellerId !== '' || email !== '') &&
      (!sellerId || z.uuid().safeParse(sellerId).success) &&
      (!email ||
        (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
    if (!validSeller) issues.push('sellerReference')
    return {
      line: row.line,
      priceOre,
      issues,
      lookup: validSeller ? { sellerId, email } : null,
    }
  })
}

/** One tenant-scoped bulk lookup; no input file or evaluation is persisted. */
export async function previewInventoryImport(
  client: SupabaseClient,
  tenantId: string,
  input: unknown,
): Promise<InventoryPreview> {
  const file = inventoryFile.parse(input),
    tenant = z.uuid().parse(tenantId)
  const currency = await readStoreCurrency(client, tenant)
  const checked = inspectInventoryRows(file, currency)
  const references = checked.flatMap((r) => (r.lookup ? [r.lookup] : []))
  const result = await client.rpc('inventory_import_sellers', {
    p_tenant: tenant,
    p_rows: references,
  })
  if (result.error)
    throw new Error(
      result.error.message === 'FORBIDDEN' ? 'FORBIDDEN' : 'REQUEST_FAILED',
    )
  const matches = z.array(match).length(references.length).parse(result.data)
  const context = await client.rpc('inventory_import_context', {
    p_tenant: tenant,
    p_sellers: [
      ...new Set(
        matches.flatMap((s) => (s.status === 'matched' ? [s.id] : [])),
      ),
    ],
  })
  if (context.error) throw new Error('REQUEST_FAILED')
  let index = 0
  return inventoryPreview.parse({
    currency,
    context: context.data,
    rows: checked.map((row) => {
      const seller = row.lookup ? matches[index++] : null
      return {
        line: row.line,
        priceOre: row.priceOre,
        seller,
        issues: [
          ...row.issues,
          ...(seller && seller.status !== 'matched' ? [seller.status] : []),
        ],
      }
    }),
  })
}

export const inventoryImportRow = z.strictObject({
  reference: z.string().trim().min(1).max(120),
  sellerId: z.uuid(),
  email: z.string().trim().max(254),
  description: z.string().trim().max(1000),
  priceOre: z.number().int().min(1).max(99999999),
  currency: currencyCode,
})
export const inventoryImportCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  source: z.string().trim().min(1).max(200),
  rows: z.array(inventoryImportRow).min(1).max(200),
  context: z.string().regex(/^[a-f0-9]{32}$/),
  received: z.literal(true),
})
export const inventoryImportResult = z.strictObject({
  requestId: z.uuid(),
  created: z.number().int().min(0).max(200),
  skipped: z.number().int().min(0).max(200),
  items: z
    .array(
      z.strictObject({
        sourceReference: z.string(),
        itemId: z.uuid(),
        reference: z.string(),
      }),
    )
    .min(1)
    .max(200),
})
export const inventoryImportErrors = [
  'FORBIDDEN',
  'CUSTODY_REQUIRED',
  'IMPORT_CHANGED',
  'IMPORT_SELLER_CHANGED',
  'IMPORT_REFERENCE_CONFLICT',
  'REQUEST_CONFLICT',
  'CURRENCY_MISMATCH',
  'AGREEMENT_REQUIRED',
  'SELLER_APPROVAL_REQUIRED',
  'INTAKE_PROFILE_FULL',
  'PLAN_LIMIT_ITEMS',
  'PLAN_PLUS_REQUIRED',
  'INVALID_INPUT',
  'DESCRIPTION_REQUIRED',
] as const

/** Explicit staff confirmation; one transaction composes the existing intake engine. */
export async function importInventory(client: SupabaseClient, input: unknown) {
  const c = inventoryImportCommand.parse(input)
  const result = await client.rpc('import_inventory', {
    p_tenant: c.tenantId,
    p_request: c.requestId,
    p_source: c.source,
    p_rows: c.rows,
    p_context: c.context,
    p_received: c.received,
  })
  if (result.error)
    throw new Error(
      inventoryImportErrors.find((code) => code === result.error.message) ??
        'REQUEST_FAILED',
    )
  const confirmed = inventoryImportResult.parse(result.data)
  if (
    confirmed.requestId !== c.requestId ||
    confirmed.created + confirmed.skipped !== c.rows.length ||
    confirmed.items.length !== c.rows.length ||
    confirmed.items.some((r, i) => r.sourceReference !== c.rows[i].reference)
  )
    throw new Error('REQUEST_FAILED')
  return confirmed
}
