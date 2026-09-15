import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  labelKind,
  LABEL_TEMPLATE_VERSION,
  referenceFormat,
  renderLabel,
} from '../labels/templates'
import { renderStoreTemplate } from '../labels/placeholders'
import { readStoreCurrency } from './money'
import { formatOre } from './items'

// Printing (P2 S19): printers per tenant and a job queue a local agent works
// through. The engine renders the label; SQL binds it to a printer and a fact.
export const registerPrinterCommand = z.strictObject({
  action: z.literal('registerPrinter'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  transport: z.enum(['tcp', 'usb']),
  address: z.string().trim().max(200).default(''),
  model: z.string().trim().max(80).default(''),
  dpi: z.union([z.literal(203), z.literal(300), z.literal(600)]).default(203),
  active: z.boolean().default(true),
})
export const labelFormatKind = z.enum([
  'bag',
  'garment',
  'item',
  'onboarding',
  'markdown',
])
export const labelPrintRule = z.strictObject({
  kind: labelFormatKind,
  printerId: z.uuid(),
  copies: z.number().int().min(1).max(20),
  enabled: z.boolean(),
})
export const setLabelPrintRuleInput = labelPrintRule.extend({
  tenantId: z.uuid(),
})

export async function readLabelPrintRules(
  client: SupabaseClient,
  tenantInput: string,
) {
  const result = await client.rpc('label_print_rules', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('FORBIDDEN')
  return z.array(labelPrintRule).max(5).parse(result.data)
}

export async function setLabelPrintRule(
  client: SupabaseClient,
  input: z.input<typeof setLabelPrintRuleInput>,
) {
  const value = setLabelPrintRuleInput.parse(input)
  const result = await client.rpc('set_label_print_rule', {
    p_tenant: value.tenantId,
    p_kind: value.kind,
    p_printer: value.printerId,
    p_copies: value.copies,
    p_enabled: value.enabled,
  })
  if (result.error)
    throw new Error(
      printErrorCodes.find((code) => result.error!.message === code) ??
        'REQUEST_FAILED',
    )
  return labelPrintRule.parse(result.data)
}
const millimetres = z.number().multipleOf(0.1)
export const setLabelFormatCommand = z.strictObject({
  action: z.literal('setLabelFormat'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  kind: labelFormatKind,
  widthMm: millimetres.min(20).max(120),
  heightMm: millimetres.min(15).max(200),
})
const size = z.object({
  widthMm: z.union([z.number(), z.string()]).transform(Number),
  heightMm: z.union([z.number(), z.string()]).transform(Number),
  custom: z.boolean(),
})
export const labelFormats = z.object({
  bag: size,
  garment: size,
  item: size,
  onboarding: size,
  markdown: size,
})
export type LabelFormats = z.infer<typeof labelFormats>

/** Every kind's size, the store's own or the default; any member. Null until the migration lands. */
export async function readLabelFormats(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('label_formats', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return labelFormats.parse(r.data)
}

export const setLabelTemplateCommand = z.strictObject({
  action: z.literal('setLabelTemplate'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  kind: labelFormatKind,
  name: z.string().trim().min(1).max(80),
  zpl: z.string().trim().min(4).max(20000),
})
export const resetLabelTemplateCommand = z.strictObject({
  action: z.literal('resetLabelTemplate'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  kind: labelFormatKind,
})
const template = z
  .object({
    id: z.guid(),
    version: z.number().int(),
    name: z.string(),
    zpl: z.string(),
    createdAt: z.string(),
  })
  .nullable()
  .optional()
export const labelTemplates = z.object({
  bag: template,
  garment: template,
  item: template,
  onboarding: template,
  markdown: template,
})
export type LabelTemplates = z.infer<typeof labelTemplates>

/** The store's current template per kind, null where the built-in layout applies; any member. */
export async function readLabelTemplates(
  client: SupabaseClient,
  tenantInput: string,
) {
  const r = await client.rpc('label_templates', {
    p_tenant: z.uuid().parse(tenantInput),
  })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return labelTemplates.parse(r.data ?? {})
}

export const cancelPrintJobCommand = z.strictObject({
  action: z.literal('cancelPrintJob'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  jobId: z.uuid(),
})
export const referenceKind = z.enum([
  'bag_receipt',
  'garment_receipt',
  'item',
  'seller',
])
export const queuePrintJobInput = z
  .strictObject({
    tenantId: z.uuid(),
    requestId: z.uuid(),
    printerId: z.uuid(),
    kind: labelKind,
    referenceKind,
    referenceId: z.guid(),
    copies: z.number().int().min(1).max(20).default(1),
  })
  .refine(
    (v) =>
      (v.kind === 'bag' && v.referenceKind === 'bag_receipt') ||
      (v.kind === 'garment' && v.referenceKind === 'garment_receipt') ||
      ((v.kind === 'item' || v.kind === 'markdown') &&
        v.referenceKind === 'item') ||
      (v.kind === 'onboarding' && v.referenceKind === 'seller'),
    'Label kind and reference kind must match',
  )
const printerRow = z.object({
  id: z.uuid(),
  name: z.string(),
  transport: z.enum(['tcp', 'usb']),
  address: z.string(),
  model: z.string(),
  dpi: z.number().int(),
  active: z.boolean(),
})
export type Printer = z.infer<typeof printerRow>
const jobRow = z.object({
  id: z.uuid(),
  printer_id: z.uuid(),
  label_kind: labelKind,
  reference_kind: referenceKind,
  reference_id: z.uuid(),
  copies: z.number().int(),
  status: z.enum(['queued', 'claimed', 'printed', 'failed', 'cancelled']),
  error: z.string(),
  created_at: z.iso.datetime({ offset: true }),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
})
export type PrintJob = z.infer<typeof jobRow>

export const printErrorCodes = [
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'REQUEST_CONFLICT',
  'PRINTER_NOT_FOUND',
  'PRINTER_INACTIVE',
  'REFERENCE_NOT_FOUND',
  'INVALID_INPUT',
  'REQUEST_FAILED',
] as const

export async function queueRenderedLabel(
  client: SupabaseClient,
  input: z.input<typeof queuePrintJobInput>,
  storeName: string,
  appOrigin: string,
) {
  const command = queuePrintJobInput.parse(input)
  const tenantId = command.tenantId
  const ore = z.union([z.number().int(), z.string()]).transform(Number)
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Stockholm',
    })
  const facts: Record<string, unknown> = {
    storeName: storeName,
    reference: '',
    currency: await readStoreCurrency(client, tenantId),
  }
  if (command.referenceKind === 'bag_receipt') {
    const bag = await client
      .from('bag_receipts')
      .select('reference,received_at')
      .eq('tenant_id', tenantId)
      .eq('id', command.referenceId)
      .maybeSingle()
    if (!bag.data) throw new Error('REFERENCE_NOT_FOUND')
    facts.reference = `K-${bag.data.reference}`
    facts.date = day(bag.data.received_at)
  } else if (command.referenceKind === 'garment_receipt') {
    const garment = await client
      .from('garment_receipts')
      .select('reference,received_at')
      .eq('tenant_id', tenantId)
      .eq('id', command.referenceId)
      .maybeSingle()
    if (!garment.data) throw new Error('REFERENCE_NOT_FOUND')
    facts.reference = `G-${garment.data.reference}`
    facts.date = day(garment.data.received_at)
  } else if (command.referenceKind === 'item') {
    const item = await client
      .from('items')
      .select('id,origin_kind,terms')
      .eq('tenant_id', tenantId)
      .eq('id', command.referenceId)
      .maybeSingle()
    if (!item.data) throw new Error('REFERENCE_NOT_FOUND')
    const prices = await client
      .from('item_prices')
      .select('price_ore,set_at')
      .eq('tenant_id', tenantId)
      .eq('item_id', command.referenceId)
      .order('set_at', { ascending: false })
      .order('seq', { ascending: false })
      .limit(2)
    const list = z.array(z.object({ price_ore: ore })).parse(prices.data ?? [])
    facts.reference = `I-${item.data.id.slice(0, 8).toUpperCase()}`
    facts.price = list[0] ? formatOre(list[0].price_ore) : undefined
    if (command.kind === 'markdown' && list[1])
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
      .eq('id', command.referenceId)
      .maybeSingle()
    if (!seller.data) throw new Error('REFERENCE_NOT_FOUND')
    facts.reference = `S-${seller.data.id.slice(0, 8).toUpperCase()}`
    facts.line1 = seller.data.name
    facts.qr = `${appOrigin}/intake/sellers/${seller.data.id}`
  }
  const printer = await client
    .from('printers')
    .select('dpi')
    .eq('tenant_id', tenantId)
    .eq('id', command.printerId)
    .maybeSingle()
  if (!printer.data) throw new Error('PRINTER_NOT_FOUND')
  const [formats, templates] = await Promise.all([
    readLabelFormats(client, tenantId),
    readLabelTemplates(client, tenantId),
  ])
  const size = formats?.[command.kind] ?? referenceFormat
  const format = {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    dpi: printer.data.dpi,
  }
  const template = templates?.[command.kind] ?? null
  const payload = template
    ? renderStoreTemplate(template.zpl, facts, format)
    : renderLabel(command.kind, facts, format)
  const templateVersion = template
    ? `store-v${template.version}`
    : LABEL_TEMPLATE_VERSION
  const queued = await client.rpc('queue_print_job', {
    p_tenant: tenantId,
    p_id: command.requestId,
    p_printer: command.printerId,
    p_kind: command.kind,
    p_template_version: templateVersion,
    p_reference_kind: command.referenceKind,
    p_reference_id: command.referenceId,
    p_payload: payload,
    p_copies: command.copies,
  })

  if (queued.error) {
    const code =
      printErrorCodes.find((value) => queued.error!.message.includes(value)) ??
      'REQUEST_FAILED'
    throw new Error(code)
  }
  return { ok: true, id: command.requestId }
}

export async function readPrinters(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client
    .from('printers')
    .select('id,name,transport,address,model,dpi,active')
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .order('name')
  if (error) throw new Error('Unable to read printers')
  return z.array(printerRow).parse(data)
}

/** Newest 50 jobs. RLS scopes the read. */
export async function readPrintJobs(
  client: SupabaseClient,
  tenantInput: string,
) {
  const { data, error } = await client
    .from('print_jobs')
    .select(
      'id,printer_id,label_kind,reference_kind,reference_id,copies,status,error,created_at,completed_at',
    )
    .eq('tenant_id', z.uuid().parse(tenantInput))
    .order('created_at', { ascending: false })
    .order('id')
    .limit(50)
  if (error) throw new Error('Unable to read print jobs')
  return z.array(jobRow).parse(data)
}
