import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { receptionSession } from './reception'

export const createReceptionCommand = z.strictObject({
  action: z.literal('createReception'),
  tenantId: z.uuid(),
  requestId: z.uuid(),
  sellerId: z.uuid(),
})
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
