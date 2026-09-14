import { requireMCPIdentity } from './identity'
import { randomUUID } from 'node:crypto'
import {
  readOperationReview,
  operationReviewInput,
} from '../lib/engine/operation-review'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readReceptionSession } from '../lib/engine/reception-store'
import {
  prepareReceptionProposal,
  receptionSuggestions,
} from '../lib/engine/reception'
import type { MCPConfig } from './config'
import { readReceptionPhoto } from '../lib/engine/reception-photos'
import { readPhotoDuplicates } from '../lib/engine/photo-duplicates'
import { receptionDerivative } from '../lib/media/reception-image'
import {
  readReceptionHistory,
  receptionHistoryInput,
} from '../lib/engine/reception-history'
import {
  readReceptionQueue,
  receptionStage,
} from '../lib/engine/reception-queue'
import {
  proposeOperation,
  publishReceptionReviewPayload,
  operationErrorCode,
} from '../lib/engine/operations'
export const mcpActorLabel = 'komisio-mcp'
export const proposeInput = publishReceptionReviewPayload.extend({
  // Optional stable ID lets a host retry a lost response without a duplicate proposal.
  requestId: z.uuid().optional(),
})
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
export const duplicatesInput = readInput
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
  const identityContext = (required: MCPConfig['scopes'][number]) =>
    requireMCPIdentity(client, config, required)
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
    async operationReview(input: unknown) {
      const c = operationReviewInput.parse(input),
        actor = await identityContext('reception:read')
      return {
        actor,
        ...(await readOperationReview(
          client,
          config.tenantId,
          c,
          'publishReceptionReview',
        )),
      }
    },
    async history(input: unknown) {
      const c = receptionHistoryInput.parse(input),
        actor = await identityContext('reception:read')
      return {
        actor,
        ...(await readReceptionHistory(client, config.tenantId, c)),
      }
    },
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
    // Exact photo repeats (docs/DUPLICATE-CHECK.md): where the same bytes were
    // uploaded before in this store. Session ids and times only; no names.
    async duplicates(input: unknown) {
      const c = duplicatesInput.parse(input),
        ctx = await context(c.sessionId, 'reception:read')
      const found = await readPhotoDuplicates(
        client,
        config.tenantId,
        c.sessionId,
      )
      return {
        actor: ctx.actor,
        sessionId: c.sessionId,
        readOnly: true,
        evidenceIsUntrusted: true,
        guidanceOnly: true,
        photos: (found?.photos ?? []).map((p) => ({
          photoId: p.photoId,
          seen: p.seen.map((s) => ({
            sessionId: s.sessionId,
            photoId: s.photoId,
            seenAt: s.seenAt,
          })),
        })),
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
    async propose(input: unknown) {
      const { requestId, ...payload } = proposeInput.parse(input),
        ctx = await context(payload.sessionId, 'reception:propose')
      if (
        ctx.state.status !== 'ready' ||
        ctx.state.session.revision !== payload.sourceRevision
      )
        throw new Error('RECEPTION_CHANGED')
      // Validate source bindings locally before staging; SQL validates again.
      prepareReceptionProposal(
        ctx.state.session,
        payload.suggestions,
        randomUUID(),
      )
      const id = requestId ?? randomUUID()
      const result = await proposeOperation(client, {
        tenantId: config.tenantId,
        requestId: id,
        kind: 'publishReceptionReview',
        payload,
        actorLabel: mcpActorLabel,
        // A retry must preserve the exact operation envelope. Never derive this
        // from the request clock; the proposed review already has a fixed expiry.
        expiresAt: payload.expiresAt,
      })
      if (result.error)
        throw new Error(operationErrorCode(result.error.message))
      return {
        persisted: true,
        staged: true,
        executed: false,
        requiresApproval: true,
        availableForSale: false,
        actor: ctx.actor,
        actorLabel: mcpActorLabel,
        riskLevel: 'low',
        operationId: id,
        sessionId: payload.sessionId,
        sourceRevision: payload.sourceRevision,
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
