import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionSession, receptionSuggestions } from './reception'

const cursor = z.number().int().min(1).max(2147483647).optional()
export const receptionHistoryInput = z.strictObject({
  sessionId: z.guid(),
  beforeSource: cursor,
  beforeReview: cursor,
})
const timestamp = z.iso.datetime({ offset: true })
const response = z.object({
  decision: z.enum(['approve', 'decline']),
  created_at: timestamp,
})
const sourceRow = z.object({
  revision: z.number().int().positive(),
  saved_at: timestamp,
  sources: receptionSession.shape.sources,
})
const reviewRow = z.object({
  version: z.number().int().positive(),
  source_revision: z.number().int().positive(),
  created_at: timestamp,
  suggestions: receptionSuggestions,
  photo_sources: z.array(z.uuid()).max(20),
  reception_responses: z.union([response.nullable(), z.array(response).max(1)]),
})

/** Bounded staff summaries, not an atomic current-state or legal audit read. */
export async function readReceptionHistory(
  client: SupabaseClient,
  tenantInput: string,
  input: z.input<typeof receptionHistoryInput>,
) {
  const tenantId = z.uuid().parse(tenantInput),
    p = receptionHistoryInput.parse(input)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (
    role.error ||
    !['owner', 'admin', 'staff', 'readonly'].includes(role.data)
  )
    throw new Error('FORBIDDEN')
  const session = await client
    .from('reception_sessions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', p.sessionId)
    .maybeSingle()
  if (session.error || !session.data) throw new Error('RECEPTION_UNAVAILABLE')
  let sources = client
    .from('reception_source_revisions')
    .select('revision,saved_at,sources')
    .eq('tenant_id', tenantId)
    .eq('session_id', p.sessionId)
    .order('revision', { ascending: false })
    .limit(21)
  let reviews = client
    .from('reception_reviews')
    .select(
      'version,source_revision,created_at,suggestions,photo_sources,reception_responses(decision,created_at)',
    )
    .eq('tenant_id', tenantId)
    .eq('session_id', p.sessionId)
    .order('version', { ascending: false })
    .limit(21)
  if (p.beforeSource !== undefined)
    sources = sources.lt('revision', p.beforeSource)
  if (p.beforeReview !== undefined)
    reviews = reviews.lt('version', p.beforeReview)
  const [s, r] = await Promise.all([sources, reviews])
  if (s.error || r.error) throw new Error('RECEPTION_UNAVAILABLE')
  const sourceRows = z.array(sourceRow).max(21).parse(s.data),
    reviewRows = z.array(reviewRow).max(21).parse(r.data)
  return {
    sessionId: p.sessionId,
    readOnly: true as const,
    evidenceIsUntrusted: true as const,
    summaryOnly: true as const,
    sources: sourceRows.slice(0, 20).map((row) => ({
      revision: row.revision,
      savedAt: row.saved_at,
      evidence: row.sources.map((source) => ({
        kind: source.kind,
        observation: source.observation,
      })),
    })),
    reviews: reviewRows.slice(0, 20).map((row) => ({
      version: row.version,
      sourceRevision: row.source_revision,
      createdAt: row.created_at,
      description:
        row.suggestions.attributes.find((a) => a.slug === 'description')
          ?.value ?? '',
      price: row.suggestions.price?.amount ?? null,
      photoCount: row.photo_sources.length,
      response: Array.isArray(row.reception_responses)
        ? (row.reception_responses[0] ?? null)
        : row.reception_responses,
    })),
    nextSource: sourceRows.length > 20 ? sourceRows[19].revision : null,
    nextReview: reviewRows.length > 20 ? reviewRows[19].version : null,
  }
}
