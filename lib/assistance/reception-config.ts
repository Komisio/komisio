import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readStorePolicy } from '../engine/store-policy'
export type ReceptionAIConfig = { key: string; model: string }

/** Reads the tenant's policy through the caller's authenticated client, then resolves. */
export async function resolveReceptionAssistance(
  client: SupabaseClient,
  tenantId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ReceptionAIConfig | null> {
  if (env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai') return null
  const policy = await readStorePolicy(client, tenantId)
  return receptionAIConfig(tenantId, env, policy.policy)
}
/** Tenant enablement comes from the store policy (P1 S9); the environment
 * allowlist remains as a pilot fallback. Provider, key and model come only from
 * the server environment, which is the kill switch: no provider, no assistance.
 * No generic API key, wildcard store or client-supplied provider URL. */
export function receptionAIConfig(
  tenantId: string,
  env: Record<string, string | undefined> = process.env,
  policy: { assistanceEnabled?: boolean } | null = null,
): ReceptionAIConfig | null {
  if (env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai') return null
  const model = env.KOMISIO_RECEPTION_AI_MODEL?.trim(),
    key = env.KOMISIO_RECEPTION_AI_KEY?.trim()
  if (!key || !model || !/^[a-zA-Z0-9._:-]{1,100}$/.test(model)) return null
  const tenants =
    env.KOMISIO_RECEPTION_AI_TENANTS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []
  if (!tenants.every((id) => z.uuid().safeParse(id).success)) return null
  const enabled =
    policy?.assistanceEnabled === true || tenants.includes(tenantId)
  return enabled ? { key, model } : null
}
