import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { labelKind } from '../labels/templates'

// Printing (P2 S19): printers per tenant and a job queue a local agent works
// through. The route renders the label; SQL binds it to a printer and a fact.
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
    referenceId: z.uuid(),
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
