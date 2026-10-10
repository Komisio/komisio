import { z } from 'zod'
import type { intakeCommand } from '@/lib/engine/intake'
import { feeAccrualResult } from '../../lib/engine/consignment-fees'

type Command = z.infer<typeof intakeCommand>
const uuid = z.uuid()
const envelope = z.object({
  ok: z.literal(true),
  commandId: uuid,
  id: z.unknown(),
})
const transfer = z.object({
  transferred: z.literal(true),
  replayed: z.boolean(),
  toTenant: uuid,
  sellerId: uuid,
  bagId: uuid,
  draftId: uuid,
})
const markdown = z.object({
  runId: uuid,
  appliedCount: z.number().int().nonnegative(),
  applied: z.array(z.unknown()),
  replayed: z.boolean(),
})
const template = z.object({
  id: uuid,
  kind: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
})
const format = z.object({
  kind: z.string(),
  widthMm: z.number(),
  heightMm: z.number(),
  custom: z.literal(true),
})

/** Confirm the caller's command separately from an engine's canonical result ID. */
export function confirmsIntakeResult(
  command: Command,
  value: unknown,
): boolean {
  const parsed = envelope.safeParse(value)
  if (!parsed.success || parsed.data.commandId !== command.requestId)
    return false
  const result = parsed.data.id
  switch (command.action) {
    case 'accrueSellerConsignmentFees': {
      const saved = feeAccrualResult.safeParse(result)
      return saved.success && saved.data.sellerId === command.sellerId
    }
    // These operations can return an already existing canonical record.
    case 'recordSale':
    case 'generateDayClose':
    case 'exportDayClose':
      return uuid.safeParse(result).success
    case 'transferItem': {
      const saved = transfer.safeParse(result)
      return saved.success && saved.data.toTenant === command.toTenantId
    }
    case 'applyDueMarkdowns': {
      const saved = markdown.safeParse(result)
      return (
        saved.success &&
        saved.data.runId === command.requestId &&
        saved.data.appliedCount === saved.data.applied.length
      )
    }
    case 'setLabelFormat': {
      const saved = format.safeParse(result)
      return (
        saved.success &&
        saved.data.kind === command.kind &&
        saved.data.widthMm === command.widthMm &&
        saved.data.heightMm === command.heightMm
      )
    }
    case 'setLabelTemplate': {
      const saved = template.safeParse(result)
      return (
        saved.success &&
        saved.data.kind === command.kind &&
        saved.data.name === command.name
      )
    }
    case 'resetLabelTemplate':
      return typeof result === 'boolean'
    case 'cancelPrintJob':
      return result === command.jobId
    default:
      return result === command.requestId
  }
}
