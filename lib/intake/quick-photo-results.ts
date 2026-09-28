import { z } from 'zod'

/**
 * What each photo phase of quick reception must answer before the screen
 * treats the phase as done. A 200 with any other body is not a confirmation:
 * the reception, object or revision may exist while only the reply was
 * damaged, so the phase is retried with the same identity. Browser-safe.
 */
export const createdReception = z.object({ ok: z.literal(true), id: z.guid() })
export const uploadedPhoto = z.object({
  source: z.object({
    id: z.uuid(),
    kind: z.literal('photo'),
    reference: z.string().min(1),
    observation: z.string(),
  }),
})
export type PhotoSource = z.infer<typeof uploadedPhoto>['source']
export const savedSources = z.object({ ok: z.literal(true), id: z.guid() })
/** The only object names the engine accepts for this photo of this reception. */
export function photoReferences(
  tenantId: string,
  sessionId: string,
  photoId: string,
) {
  return ['png', 'jpg'].map(
    (ext) => `${tenantId}/${sessionId}/${photoId}.${ext}`,
  )
}
