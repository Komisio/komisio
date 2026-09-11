import { z } from 'zod'

// Suggestions contain descriptive data only. Unknown keys fail closed, so an
// adapter cannot silently introduce prices, approval flags or tenant authority.
export const inspectionFields = z.strictObject({
  description: z.string().trim().max(1000),
  category: z.string().trim().max(120),
  condition: z.string().trim().max(500),
})
export const inspectionDraft = z.strictObject({
  schemaVersion: z.literal(1),
  tenantId: z.uuid(),
  bagId: z.uuid(),
  draftId: z.uuid(),
  revision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  fields: inspectionFields,
})
export const inspectionProposal = z.strictObject({
  schemaVersion: z.literal(1),
  tenantId: z.uuid(),
  bagId: z.uuid(),
  draftId: z.uuid(),
  baseRevision: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  proposalId: z.uuid(),
  suggestions: inspectionFields
    .partial()
    .refine((v) => Object.keys(v).length > 0),
})
const fieldName = z.enum(['description', 'category', 'condition'])
const selection = z
  .array(fieldName)
  .min(1)
  .max(3)
  .refine((v) => new Set(v).size === v.length)
export type InspectionDraft = z.infer<typeof inspectionDraft>
export type InspectionProposal = z.infer<typeof inspectionProposal>
export type InspectionField = z.infer<typeof fieldName>

// Persisted revision is separate from the in-memory edit revision above.
export const saveInspectionCommand = z.strictObject({
  action: z.literal('saveInspection'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  bagId: z.uuid(),
  draftId: z.uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  fields: inspectionFields.extend({
    description: z.string().trim().min(1).max(1000),
  }),
})

export type SavedInspection = {
  draft_id: string
  revision: number
  description: string
  category: string
  condition: string
  saved_at: string
}

/** Pure draft operation; no persistence, authorization, approval or model call. */
export function editInspectionDraft(
  input: unknown,
  fields: unknown,
): InspectionDraft {
  const draft = inspectionDraft.parse(input)
  return inspectionDraft.parse({
    ...draft,
    revision: draft.revision + 1,
    fields: inspectionFields.parse(fields),
  })
}

/** Explicitly selected suggestions only. A late response cannot overwrite edits. */
export function applyInspectionProposal(
  input: unknown,
  proposalInput: unknown,
  selectedInput: unknown,
): InspectionDraft {
  const draft = inspectionDraft.parse(input)
  const proposal = inspectionProposal.parse(proposalInput)
  const selected = selection.parse(selectedInput)
  if (
    draft.tenantId !== proposal.tenantId ||
    draft.bagId !== proposal.bagId ||
    draft.draftId !== proposal.draftId
  ) {
    throw new Error('INSPECTION_CONTEXT_CHANGED')
  }
  if (draft.revision !== proposal.baseRevision)
    throw new Error('INSPECTION_DRAFT_CHANGED')
  const fields = { ...draft.fields }
  for (const field of selected) {
    const value = proposal.suggestions[field]
    if (value === undefined) throw new Error('INSPECTION_SUGGESTION_MISSING')
    fields[field] = value
  }
  return editInspectionDraft(draft, fields)
}

/** A usable description is required to prepare a preview, never proof of receipt. */
export function previewInspection(input: unknown) {
  const draft = inspectionDraft.parse(input)
  if (!draft.fields.description)
    throw new Error('INSPECTION_DESCRIPTION_REQUIRED')
  return {
    kind: 'inspection-preview' as const,
    persisted: false as const,
    availableForSale: false as const,
    draft,
  }
}
