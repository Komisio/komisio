import type { SupabaseClient } from '@supabase/supabase-js'
import type { MCPConfig } from './config'
import { requireMCPIdentity } from './identity'
import {
  briefRequest,
  readEconomyBrief,
  renderBrief,
} from '../lib/engine/brief'
import { dictionary } from '../lib/i18n'

// The weekly or monthly brief for agents (P3): the same deterministic
// sentences the economy page shows, with the numbers they are built from.
// Amounts are öre in the numbers and formatted in the sentences; no seller
// names, no writes, no forecast.
export const economyBriefInput = briefRequest

export async function readEconomyBriefTool(
  client: SupabaseClient,
  config: MCPConfig,
  input: unknown,
) {
  const request = economyBriefInput.parse(input)
  const actor = await requireMCPIdentity(client, config, 'economy:read')
  const brief = await readEconomyBrief(client, config.tenantId, request)
  if (!brief) throw new Error('BRIEF_UNAVAILABLE')
  const rendered = renderBrief(brief, dictionary('en').brief)
  return {
    actor,
    readOnly: true,
    evidenceIsUntrusted: true,
    guidanceOnly: true,
    amountUnit: 'ore',
    title: rendered.title,
    lines: rendered.lines,
    facts: rendered.facts,
    ...brief,
  }
}
