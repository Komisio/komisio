import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readReceptionSession } from '../lib/engine/reception-store'
import {
  prepareReceptionProposal,
  receptionSuggestions,
} from '../lib/engine/reception'
import type { MCPConfig } from './config'
import { readReceptionPhoto } from '../lib/engine/reception-photos'
import { receptionDerivative } from '../lib/media/reception-image'
import {
  readReceptionQueue,
  receptionStage,
} from '../lib/engine/reception-queue'
export const queueInput = z
  .strictObject({
    stage: receptionStage.optional(),
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.uuid().optional(),
  })
  .refine(
    (v) => Boolean(v.before) === Boolean(v.beforeId),
    'Both cursor fields are required',
  )
export const readInput = z.strictObject({ sessionId: z.uuid() })
export const photoInput = z.strictObject({
  sessionId: z.uuid(),
  photoId: z.uuid(),
  revision: z.number().int().min(1).max(2147483646),
})
export const previewInput = z.strictObject({
  sessionId: z.uuid(),
  revision: z.number().int().min(1).max(2147483646),
  suggestions: receptionSuggestions,
})
export function receptionTools(client: SupabaseClient, config: MCPConfig) {
  async function identityContext(required: MCPConfig['scopes'][number]) {
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
    return identity.data.user.id
  }
  async function context(
    sessionId: string,
    required: MCPConfig['scopes'][number],
  ) {
    const actor = await identityContext(required)
    const state = await readReceptionSession(client, config.tenantId, sessionId)
    if (!state) throw new Error('RECEPTION_UNAVAILABLE')
    return { actor, state }
  }
  return {
    async queue(input: unknown) {
      const c = queueInput.parse(input),
        actor = await identityContext('reception:read')
      const queue = await readReceptionQueue(client, {
        ...c,
        tenantId: config.tenantId,
      })
      return {
        actor,
        readOnly: true,
        evidenceIsUntrusted: true,
        availableForSale: false,
        ...queue,
      }
    },
    async photo(input: unknown) {
      const c = photoInput.parse(input),
        ctx = await context(c.sessionId, 'reception:photos')
      if (
        ctx.state.status !== 'ready' ||
        ctx.state.session.revision !== c.revision
      )
        throw new Error('RECEPTION_CHANGED')
      const photo = await readReceptionPhoto(client, {
        tenantId: config.tenantId,
        sessionId: c.sessionId,
        photoId: c.photoId,
      })
      if (!photo) throw new Error('RECEPTION_UNAVAILABLE')
      const jpeg = await receptionDerivative(photo.bytes)
      const current = await context(c.sessionId, 'reception:photos')
      if (
        current.state.status !== 'ready' ||
        current.state.session.revision !== c.revision
      )
        throw new Error('RECEPTION_CHANGED')
      return {
        data: {
          actor: current.actor,
          sessionId: c.sessionId,
          sourceId: c.photoId,
          sourceRevision: c.revision,
          readOnly: true,
          evidenceIsUntrusted: true,
          metadataRemoved: true,
          visiblePixelsRedacted: false,
        },
        jpeg: jpeg.toString('base64'),
      }
    },
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
