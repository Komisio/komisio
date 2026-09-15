import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionSession, receptionSuggestions } from './reception'

export const publishReceptionReviewCommand = z.strictObject({
  action: z.literal('publishReceptionReview'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sessionId: z.guid(),
  sourceRevision: z.number().int().min(1).max(2147483646),
  previousReviewId: z.uuid().nullable(),
  agreementId: z.uuid().nullable(),
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
    sessionId = z.guid().parse(sessionInput)
  const { data: review, error } = await client
    .from('reception_reviews')
    .select(
      'id,version,source_revision,agreement_id,seller_email,suggestions,expires_at,photo_sources',
    )
    .eq('tenant_id', tenantId)
    .eq('session_id', sessionId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('Unable to read reception review')
  if (!review) return null
  const { data: terms, error: termsError } = review.agreement_id
    ? await client
        .from('seller_agreement_versions')
        .select('id,title,body,language')
        .eq('tenant_id', tenantId)
        .eq('id', review.agreement_id)
        .single()
    : { data: null, error: null }
  if (termsError) throw new Error('Unable to read review terms')
  const { data: access, error: accessError } = await client
    .from('reception_access_events')
    .select('id,version,token_hash')
    .eq('review_id', review.id)
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (accessError) throw new Error('Unable to read review access')
  const { data: response, error: responseError } = await client
    .from('reception_responses')
    .select('decision,created_at')
    .eq('review_id', review.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (responseError) throw new Error('Unable to read review response')
  return {
    id: review.id,
    version: review.version,
    sourceRevision: review.source_revision,
    photos: z.array(z.uuid()).max(20).parse(review.photo_sources),
    suggestions: receptionSuggestions.parse(review.suggestions),
    expiresAt: review.expires_at,
    expired: Date.parse(review.expires_at) <= Date.now(),
    sellerEmail: review.seller_email,
    access: access
      ? {
          id: access.id,
          version: access.version,
          enabled: access.token_hash !== null,
        }
      : null,
    response,
    terms: terms
      ? {
          versionId: terms.id,
          title: terms.title,
          body: terms.body,
          language: terms.language,
        }
      : null,
  }
}
export const saveReceptionSourcesCommand = z.strictObject({
  action: z.literal('saveReceptionSources'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sessionId: z.guid(),
  expectedRevision: z.number().int().min(0).max(2147483646),
  sources: receptionSession.shape.sources.refine((sources) =>
    sources.every(
      (source) =>
        source.kind !== 'photo' ||
        /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(png|jpg)$/.test(
          source.reference,
        ),
    ),
  ),
})

export async function readReceptionSession(
  client: SupabaseClient,
  tenantInput: string,
  sessionInput: string,
) {
  const tenantId = z.uuid().parse(tenantInput),
    sessionId = z.guid().parse(sessionInput)
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
