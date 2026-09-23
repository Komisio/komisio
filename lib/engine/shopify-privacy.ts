import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { seal, open, sealedBox } from '../platform/credentials'
import { supabaseEnv } from '../supabase/env'
import {
  privacyTopics,
  type parsePrivacyRequest,
} from '../../extensions/shopify/privacy'

const PURPOSE = 'shopify-privacy'
export async function shopifyPrivacyActor(
  env: Record<string, string | undefined> = process.env,
) {
  const email = env.SHOPIFY_WEBHOOK_EMAIL?.trim()
  const password = env.SHOPIFY_WEBHOOK_PASSWORD
  if (!email || !password) return null
  const { url, key } = supabaseEnv()
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const result = await client.auth.signInWithPassword({ email, password })
  if (result.error) throw new Error('SHOPIFY_PRIVACY_ACTOR_UNAVAILABLE')
  return client
}
export async function receiveShopifyPrivacy(
  client: SupabaseClient,
  request: ReturnType<typeof parsePrivacyRequest>,
  env: Record<string, string | undefined>,
) {
  const { error } = await client.rpc('receive_shopify_privacy', {
    p_topic: request.topic,
    p_shop: request.shop,
    p_fingerprint: request.fingerprint,
    p_cipher: seal(PURPOSE, request.payload, env),
  })
  if (error) throw new Error('SHOPIFY_PRIVACY_RECEIPT_FAILED')
}
const row = z.object({
  id: z.uuid(),
  tenantId: z.uuid().nullable(),
  topic: z.enum(privacyTopics),
  shopDomain: z.string(),
  receivedAt: z.string(),
  dueAt: z.string(),
  cipher: sealedBox,
  status: z.enum(['pending', 'processing', 'completed', 'retained']),
  revision: z.uuid().nullable(),
  history: z.array(
    z.object({
      status: z.enum(['processing', 'completed', 'retained']),
      note: z.string(),
      actor: z.uuid(),
      at: z.string(),
    }),
  ),
})
export type PrivacyRequestRow = Omit<z.infer<typeof row>, 'cipher'> & {
  details: unknown
}
export async function readShopifyPrivacy(
  client: SupabaseClient,
  tenant: string | null,
  env: Record<string, string | undefined> = process.env,
): Promise<PrivacyRequestRow[]> {
  const { data, error } = await client.rpc('shopify_privacy_queue', {
    p_tenant: tenant === null ? null : z.uuid().parse(tenant),
  })
  if (error?.code === 'PGRST202') return []
  if (error) throw new Error('FORBIDDEN')
  return z
    .array(row)
    .parse(data)
    .map(({ cipher, ...r }) => ({ ...r, details: open(PURPOSE, cipher, env) }))
}
export const privacyOutcome = z.object({
  requestId: z.uuid(),
  previousId: z.uuid().nullable(),
  id: z.uuid(),
  status: z.enum(['processing', 'completed', 'retained']),
  note: z.string().trim().min(1).max(1000),
})
export async function recordShopifyPrivacyOutcome(
  client: SupabaseClient,
  input: z.infer<typeof privacyOutcome>,
) {
  const v = privacyOutcome.parse(input)
  const { error } = await client.rpc('record_shopify_privacy_outcome', {
    p_request: v.requestId,
    p_previous: v.previousId,
    p_id: v.id,
    p_status: v.status,
    p_note: v.note,
  })
  if (error)
    throw new Error(
      error.message === 'REQUEST_CONFLICT' ? 'REQUEST_CONFLICT' : 'FORBIDDEN',
    )
}
