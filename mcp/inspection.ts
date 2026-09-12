import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { readInspection } from '../lib/engine/inspection-read'
import { requireMCPIdentity } from './identity'

export async function readInspectionTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const actor = await requireMCPIdentity(client, config, 'inspection:read')
  const result = await readInspection(client, config.tenantId, input)
  return { ...result, actor, bag: { reference: result.bag.reference } }
}
