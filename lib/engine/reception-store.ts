import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionSession, receptionSuggestions } from './reception'

export const publishReceptionReviewCommand = z.strictObject({
  action: z.literal('publishReceptionReview'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  sourceRevision: z.number().int().min(1).max(2147483646),
  previousReviewId: z.uuid().nullable(),
  agreementId: z.uuid(),
  expiresAt: z.iso.datetime(),
  suggestions: receptionSuggestions.refine(
    (s) =>
      !!s.metadata.description &&
      !!s.price &&
      s.questions.length === 0 &&
      Object.values(s.metadata).every((f) => f?.certainty === 'observed'),
  ),
})

export const createReceptionCommand = z.strictObject({
  action: z.literal('createReception'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sellerId: z.uuid(),
})

/** Staff read only. Seller review access has a separate authorization boundary. */
export async function readReceptionReview(
  client: SupabaseClient,
  tenantInput: string,
  sessionInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput),
    sessionId = z.uuid().parse(sessionInput)
  const { data: review, error } = await client
    .from('reception_reviews_current')
    .select('id,version,source_revision,agreement_id,suggestions,expires_at')
    .eq('tenant_id', tenantId)
    .eq('session_id', sessionId)
    .maybeSingle()
  if (error) throw new Error('Unable to read reception review')
  if (!review) return null
  const { data: terms, error: termsError } = await client
    .from('seller_agreement_versions')
    .select('id,title,body,language')
    .eq('tenant_id', tenantId)
    .eq('id', review.agreement_id)
    .single()
  if (termsError) throw new Error('Unable to read review terms')
  return {
    id: review.id,
    version: review.version,
    sourceRevision: review.source_revision,
    suggestions: receptionSuggestions.parse(review.suggestions),
    expiresAt: review.expires_at,
    terms: {
      versionId: terms.id,
      title: terms.title,
      body: terms.body,
      language: terms.language,
    },
  }
}
export const saveReceptionSourcesCommand = z.strictObject({
  action: z.literal('saveReceptionSources'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sessionId: z.uuid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  sources: receptionSession.shape.sources.refine((sources) =>
    sources.every((source) => source.kind !== 'photo'),
  ),
})

export async function readReceptionSession(
  client: SupabaseClient,
  tenantInput: string,
  sessionInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput),
    sessionId = z.uuid().parse(sessionInput)
  const [session, snapshot] = await Promise.all([
    client
      .from('reception_sessions')
      .select('id,seller_id')
      .eq('tenant_id', tenantId)
      .eq('id', sessionId)
      .maybeSingle(),
    client
      .from('reception_sources_current')
      .select('revision,sources')
      .eq('tenant_id', tenantId)
      .eq('session_id', sessionId)
      .maybeSingle(),
  ])
  if (session.error || snapshot.error)
    throw new Error('Unable to read reception')
  if (!session.data) return null
  if (!snapshot.data)
    return {
      status: 'empty' as const,
      persisted: true as const,
      sessionId,
      tenantId,
      sellerId: session.data.seller_id,
      revision: 0,
    }
  return {
    status: 'ready' as const,
    persisted: true as const,
    session: receptionSession.parse({
      schemaVersion: 1,
      tenantId,
      sessionId,
      sellerId: session.data.seller_id,
      revision: snapshot.data.revision,
      sources: snapshot.data.sources,
    }),
  }
}
