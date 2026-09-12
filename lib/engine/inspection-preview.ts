import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readInspection } from './inspection-read'
import {
  inspectionProposal,
  inspectionFields,
  editInspectionDraft,
  previewInspection,
} from './inspection'

export const inspectionPreviewInput = z.strictObject({
  bagId: z.uuid(),
  draftId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483646),
  suggestions: inspectionProposal.shape.suggestions,
})

/** Read and simulate only: no persistence, staging or human approval. */
export async function previewSavedInspection(
  client: SupabaseClient,
  tenantInput: string,
  input: unknown,
) {
  const tenantId = z.uuid().parse(tenantInput),
    c = inspectionPreviewInput.parse(input)
  const { selected } = await readInspection(client, tenantId, {
    bagId: c.bagId,
    draft: c.draftId,
  })
  if (!selected) throw new Error('INSPECTION_UNAVAILABLE')
  if (selected.archived) throw new Error('INSPECTION_ARCHIVED')
  if (selected.revision !== c.expectedRevision)
    throw new Error('INSPECTION_DRAFT_CHANGED')
  const before = inspectionFields.parse({
    description: selected.description,
    category: selected.category,
    condition: selected.condition,
  })
  const edited = editInspectionDraft(
    {
      schemaVersion: 1,
      tenantId,
      bagId: c.bagId,
      draftId: c.draftId,
      revision: selected.revision,
      fields: before,
    },
    { ...before, ...c.suggestions },
  )
  const after = previewInspection(edited).draft.fields
  const fields = ['description', 'category', 'condition'] as const
  return {
    kind: 'inspection-proposal-preview' as const,
    persisted: false as const,
    staged: false as const,
    approved: false as const,
    availableForSale: false as const,
    evidenceIsUntrusted: true as const,
    bagId: c.bagId,
    draftId: c.draftId,
    baseRevision: selected.revision,
    before,
    after,
    changes: fields
      .filter((field) => before[field] !== after[field])
      .map((field) => ({ field, before: before[field], after: after[field] })),
  }
}
