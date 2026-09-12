import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { inspectionFields } from './inspection'
import { garmentSuggestions } from './reception'
import { readInspection } from './inspection-read'

const revision = z.number().int().min(1).max(2147483647)
export const inspectionReceptionInput = z.strictObject({
  bagId: z.uuid(),
  draftId: z.uuid(),
  expectedRevision: revision,
})
const snapshot = z.strictObject({
  bagId: z.uuid(),
  draftId: z.uuid(),
  revision,
  archived: z.boolean(),
  fields: inspectionFields,
})

/** Pure contract comparison. The adapter must supply an authorized saved snapshot. */
export function prepareInspectionReception(input: unknown) {
  const draft = snapshot.parse(input)
  if (draft.archived) throw new Error('INSPECTION_ARCHIVED')
  if (!draft.fields.description)
    throw new Error('INSPECTION_DESCRIPTION_REQUIRED')
  const fields = ['description', 'category', 'condition'] as const
  return {
    kind: 'inspection-reception-preparation' as const,
    schemaVersion: 1 as const,
    readOnly: true as const,
    persisted: false as const,
    staged: false as const,
    approved: false as const,
    availableForSale: false as const,
    readyToPublish: false as const,
    evidenceIsUntrusted: true as const,
    origin: {
      kind: 'inspection-draft-revision' as const,
      bagId: draft.bagId,
      draftId: draft.draftId,
      revision: draft.revision,
    },
    candidates: fields
      .filter((field) => !!draft.fields[field])
      .map((field) => ({
        field,
        // Check representability without constructing a sourced reception fact.
        value: garmentSuggestions.shape[field]
          .unwrap()
          .shape.value.parse(draft.fields[field]),
        requiresFactReview: true as const,
        requiresSource: true as const,
      })),
    // These are unassessed steps, not assertions that other records do not exist.
    stepsToCheck: [
      'select_reception',
      'record_descriptive_sources',
      'review_sourced_price',
      'select_published_terms',
      'review_facts',
    ] as const,
    otherRecordsChecked: false as const,
  }
}
export type InspectionReceptionPreparation = ReturnType<
  typeof prepareInspectionReception
>

export async function readInspectionReceptionPreparation(
  client: SupabaseClient,
  tenantId: string,
  input: unknown,
) {
  const c = inspectionReceptionInput.parse(input)
  const { selected } = await readInspection(client, tenantId, {
    bagId: c.bagId,
    draft: c.draftId,
  })
  if (!selected) throw new Error('INSPECTION_UNAVAILABLE')
  if (selected.archived) throw new Error('INSPECTION_ARCHIVED')
  if (selected.revision !== c.expectedRevision)
    throw new Error('INSPECTION_DRAFT_CHANGED')
  return prepareInspectionReception({
    bagId: c.bagId,
    draftId: c.draftId,
    revision: selected.revision,
    archived: selected.archived,
    fields: {
      description: selected.description,
      category: selected.category,
      condition: selected.condition,
    },
  })
}
