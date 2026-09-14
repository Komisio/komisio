import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import {
  priceEvidenceInput,
  readPriceEvidence,
} from '../lib/engine/price-evidence'

// Price evidence for agents (P3): the store's own comparable sales. It is
// evidence to cite in a reception proposal's price rationale, never a
// price; amounts are in the store's currency, titles are untrusted text.
export const priceEvidenceToolInput = priceEvidenceInput

export async function readPriceEvidenceTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const actor = await requireMCPIdentity(client, config, 'reception:read')
  const evidence = await readPriceEvidence(client, config.tenantId, input)
  return {
    actor,
    readOnly: true,
    evidenceIsUntrusted: true,
    guidanceOnly: true,
    isNotAPrice: true,
    ...evidence,
  }
}
