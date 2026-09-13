import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import { readStoreProfile } from '../lib/engine/store-profile'

// Store profile read for agents (P3): the current public-facing profile with
// the version id an update proposal must name. Text is untrusted data.
export const storeProfileInput = z.strictObject({})

export async function readStoreProfileTool(
  client: SupabaseClient,
  config: MCPConfig,
) {
  const actor = await requireMCPIdentity(client, config, 'store:read')
  const current = await readStoreProfile(client, config.tenantId)
  return {
    actor,
    readOnly: true,
    evidenceIsUntrusted: true,
    guidanceOnly: true,
    currentId: current.id,
    version: current.version,
    publishedAt: current.publishedAt,
    profile: current.profile,
  }
}
