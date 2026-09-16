import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assistanceCommand,
  reserveReceptionAssistance,
} from '../engine/reception-assistance'
import { readReceptionSession } from '../engine/reception-store'
import { readReceptionPhoto } from '../engine/reception-photos'
import { suggestReception } from './reception'
import { suggestReceptionBatch } from './reception-batch'
import { resolveReceptionAssistance } from './reception-config'
import { receptionImage } from './reception-image'
import { settleAssistance } from '../engine/ai-credits'
import {
  openAIReception,
  receptionPromptVersion,
  batchPromptVersion,
} from './openai-reception'

/** All caller identities/objects come from authenticated database reads, never model output. */
export async function runReceptionAssistance(
  client: SupabaseClient,
  input: unknown,
  signal: AbortSignal,
) {
  const c = assistanceCommand.parse(input)
  const role = await client.rpc('tenant_role', { p_tenant: c.tenantId })
  if (role.error || !['owner', 'admin', 'staff'].includes(role.data))
    throw new Error('FORBIDDEN')
  const state = await readReceptionSession(client, c.tenantId, c.sessionId)
  if (state?.status !== 'ready' || state.session.revision !== c.revision)
    throw new Error('RECEPTION_CHANGED')
  const config = await resolveReceptionAssistance(client, c.tenantId)
  if (!config) return { status: 'unavailable' as const, proposal: null }
  const photos = state.session.sources.filter((s) => s.kind === 'photo')
  if (c.mode === 'batch' && !photos.length)
    throw new Error('BATCH_PHOTOS_REQUIRED')
  if (photos.length > 3) throw new Error('ASSISTANCE_IMAGE_LIMIT')
  signal.throwIfAborted()
  if (
    !(await reserveReceptionAssistance(
      client,
      c,
      config.model,
      c.mode === 'batch' ? batchPromptVersion : receptionPromptVersion,
    ))
  )
    throw new Error('ASSISTANCE_ALREADY_ATTEMPTED')
  const images = new Map<string, string>()
  for (const source of photos) {
    signal.throwIfAborted()
    const photo = await readReceptionPhoto(client, {
      tenantId: c.tenantId,
      sessionId: c.sessionId,
      photoId: source.id,
    })
    if (!photo) throw new Error('ASSISTANCE_IMAGE_UNAVAILABLE')
    images.set(source.id, await receptionImage(photo.bytes))
  }
  const suggest = c.mode === 'batch' ? suggestReceptionBatch : suggestReception
  const adapter = openAIReception(config, images, fetch, c.mode ?? 'single')
  let result
  try {
    result = await suggest(state.session, c.requestId, adapter, signal)
  } finally {
    // The reservation becomes the actual cost; a failed call releases it.
    await settleAssistance(
      client,
      c.tenantId,
      c.requestId,
      adapter.usage?.() ?? null,
    ).catch(() => undefined)
  }
  const current = await readReceptionSession(client, c.tenantId, c.sessionId),
    currentRole = await client.rpc('tenant_role', { p_tenant: c.tenantId })
  if (
    currentRole.error ||
    !['owner', 'admin', 'staff'].includes(currentRole.data)
  )
    throw new Error('FORBIDDEN')
  if (current?.status !== 'ready' || current.session.revision !== c.revision)
    throw new Error('RECEPTION_CHANGED')
  signal.throwIfAborted()
  return result
}
