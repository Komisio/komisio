import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readReceptionSession } from '../lib/engine/reception-store'
import {
  prepareReceptionProposal,
  receptionSuggestions,
} from '../lib/engine/reception'
import type { MCPConfig } from './config'
export const readInput = z.strictObject({ sessionId: z.uuid() })
export const previewInput = z.strictObject({
  sessionId: z.uuid(),
  revision: z.number().int().min(1).max(2147483646),
  suggestions: receptionSuggestions,
})
export function receptionTools(client: SupabaseClient, config: MCPConfig) {
  async function context(
    sessionId: string,
    required: MCPConfig['scopes'][number],
  ) {
    if (!config.scopes.includes(required)) throw new Error('SCOPE_REQUIRED')
    const identity = await client.auth.getUser(config.token)
    if (identity.error || !identity.data.user?.email_confirmed_at)
      throw new Error('AUTH_REQUIRED')
    const role = await client.rpc('tenant_role', { p_tenant: config.tenantId })
    if (
      role.error ||
      !['owner', 'admin', 'staff', 'readonly'].includes(role.data)
    )
      throw new Error('FORBIDDEN')
    const state = await readReceptionSession(client, config.tenantId, sessionId)
    if (!state) throw new Error('RECEPTION_UNAVAILABLE')
    return { actor: identity.data.user.id, state }
  }
  return {
    async read(input: unknown) {
      const c = readInput.parse(input),
        ctx = await context(c.sessionId, 'reception:read')
      return {
        persisted: ctx.state.persisted,
        actor: ctx.actor,
        readOnly: true,
        source: ctx.state,
        evidenceIsUntrusted: true,
      }
    },
    async preview(input: unknown) {
      const c = previewInput.parse(input),
        ctx = await context(c.sessionId, 'reception:preview')
      if (
        ctx.state.status !== 'ready' ||
        ctx.state.session.revision !== c.revision
      )
        throw new Error('RECEPTION_CHANGED')
      const proposal = prepareReceptionProposal(
        ctx.state.session,
        c.suggestions,
        randomUUID(),
      )
      for (const fact of Object.values(proposal.suggestions.metadata))
        if (fact) fact.certainty = 'tentative'
      return {
        persisted: false,
        staged: false,
        requiresStaffReview: true,
        availableForSale: false,
        actor: ctx.actor,
        proposal,
      }
    },
  }
}
