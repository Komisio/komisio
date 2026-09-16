import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { open, seal } from '../platform/credentials'
import {
  createCreditsCheckoutSession,
  stripeCreditsConfigured,
  type StripeEnvironment,
} from '../../extensions/stripe/api'

// AI credits (owner decision 2026-09-16): Komisio is free and open; the only
// metered resource is the assistant's model usage on the host's own key. One
// credit is one krona, held in öre. Every store on a hosted deployment gets an
// included monthly amount, can buy more, or connects its own provider key, in
// which case nothing is metered. SQL holds the balances, the reservation
// before a call and the settlement after it; this module reads and forwards.

export const aiCredits = z.object({
  enabled: z.boolean(),
  period: z.string(),
  includedOre: z.number().int(),
  includedLeftOre: z.number().int(),
  purchasedLeftOre: z.number().int(),
  usedThisPeriodOre: z.number().int(),
  packOre: z.number().int(),
  ownKey: z.boolean(),
  ownModel: z.string().nullable(),
  capReached: z.boolean(),
  estimatedItemsPerMonth: z.number().int(),
})
export type AiCredits = z.infer<typeof aiCredits>
export async function readAiCredits(client: SupabaseClient, tenant: string) {
  const r = await client.rpc('ai_credits', { p_tenant: z.uuid().parse(tenant) })
  if (r.error?.code === 'PGRST202') return null
  if (r.error) throw new Error('FORBIDDEN')
  return aiCredits.parse(r.data)
}

/** Whole kronor for display: 100 credits are 100 kr are 10 000 öre. */
export function credits(ore: number) {
  return Math.floor(ore / 100)
}

// The store's own provider key, sealed with the credential key; SQL never sees it in clear.
const PURPOSE = 'ai-connection'
export const ownKeyCommand = z.strictObject({
  tenantId: z.uuid(),
  provider: z.literal('openai'),
  model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/),
  key: z.string().min(20).max(400),
})
export async function storeOwnKey(
  client: SupabaseClient,
  input: unknown,
  env: Record<string, string | undefined> = process.env,
) {
  const c = ownKeyCommand.parse(input)
  const r = await client.rpc('store_ai_connection', {
    p_tenant: c.tenantId,
    p_provider: c.provider,
    p_model: c.model,
    p_cipher: seal(PURPOSE, { key: c.key }, env),
  })
  if (r.error) throw new Error(aiCreditsErrorCode(r.error.message))
  return z.object({ provider: z.string(), model: z.string() }).parse(r.data)
}
export async function removeOwnKey(client: SupabaseClient, tenant: string) {
  const r = await client.rpc('remove_ai_connection', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (r.error) throw new Error(aiCreditsErrorCode(r.error.message))
}
/** The store's own configuration for a run, or null when the store runs on the host's key. */
export async function readOwnKeyConfig(
  client: SupabaseClient,
  tenant: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ key: string; model: string } | null> {
  const r = await client.rpc('ai_connection_cipher', {
    p_tenant: z.uuid().parse(tenant),
  })
  if (r.error || r.data === null) return null
  const row = z
    .object({
      provider: z.literal('openai'),
      model: z.string(),
      cipher: z.unknown(),
    })
    .parse(r.data)
  const secret = z
    .object({ key: z.string().min(1) })
    .parse(open(PURPOSE, row.cipher, env))
  return { key: secret.key, model: row.model }
}

/** After the model answered: the reservation becomes the actual token cost. Zero tokens releases it. */
export async function settleAssistance(
  client: SupabaseClient,
  tenant: string,
  requestId: string,
  usage: { inputTokens: number; outputTokens: number } | null,
) {
  const r = await client.rpc('settle_reception_assistance', {
    p_tenant: z.uuid().parse(tenant),
    p_request: z.uuid().parse(requestId),
    p_input_tokens: usage?.inputTokens ?? 0,
    p_output_tokens: usage?.outputTokens ?? 0,
  })
  if (r.error) throw new Error(aiCreditsErrorCode(r.error.message))
  return z
    .object({ metered: z.boolean(), costOre: z.number().int().optional() })
    .parse(r.data)
}

// Buying a pack: Stripe Checkout in payment mode; the webhook records the purchase once.
export async function startCreditsCheckout(
  client: SupabaseClient,
  tenantInput: string,
  email: string,
  origin: string,
  env: StripeEnvironment,
  http?: typeof fetch,
) {
  const tenantId = z.uuid().parse(tenantInput)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data))
    throw new Error('FORBIDDEN')
  if (!stripeCreditsConfigured(env)) throw new Error('STRIPE_NOT_CONFIGURED')
  const current = await readAiCredits(client, tenantId)
  if (!current) throw new Error('NOT_AVAILABLE')
  const session = await createCreditsCheckoutSession(
    env,
    {
      tenantId,
      email,
      amountOre: current.packOre,
      successUrl: `${origin}/settings?tab=credits&credits=success`,
      cancelUrl: `${origin}/settings?tab=credits&credits=cancelled`,
      idempotencyKey: `credits:${tenantId}:${Math.floor(Date.now() / 60000)}`,
    },
    http,
  )
  return { url: session.url }
}

// Host: platform-wide settings and the showcase list.
export const aiPlatformSettings = z.object({
  enabled: z.boolean(),
  monthlyCapOre: z.number().int(),
  includedOre: z.number().int(),
  packOre: z.number().int(),
  reserveOre: z.number().int(),
  reserveBatchOre: z.number().int(),
  inputOrePerMillion: z.number(),
  outputOrePerMillion: z.number(),
  period: z.string(),
  capUsedOre: z.number().int(),
  showcase: z.array(z.object({ tenantId: z.uuid(), label: z.string() })),
})
export type AiPlatformSettings = z.infer<typeof aiPlatformSettings>
export async function readAiPlatformSettings(client: SupabaseClient) {
  const r = await client.rpc('ai_platform_settings')
  if (r.error) throw new Error(aiCreditsErrorCode(r.error.message))
  return aiPlatformSettings.parse(r.data)
}
export const aiSettingsCommand = z.strictObject({
  enabled: z.boolean().optional(),
  monthlyCapOre: z.number().int().min(0).max(100_000_000).optional(),
  includedOre: z.number().int().min(0).max(10_000_000).optional(),
  packOre: z.number().int().min(100).max(10_000_000).optional(),
  reserveOre: z.number().int().min(1).max(100_000).optional(),
  reserveBatchOre: z.number().int().min(1).max(100_000).optional(),
  inputOrePerMillion: z.number().min(0).max(1_000_000).optional(),
  outputOrePerMillion: z.number().min(0).max(1_000_000).optional(),
})
export async function setAiPlatformSettings(
  client: SupabaseClient,
  input: unknown,
) {
  const r = await client.rpc('set_ai_platform_settings', {
    p: aiSettingsCommand.parse(input),
  })
  if (r.error) throw new Error(aiCreditsErrorCode(r.error.message))
  return aiPlatformSettings.parse(r.data)
}
export const showcaseCommand = z.strictObject({
  tenantId: z.uuid(),
  label: z.string().trim().max(120),
})
export async function setStoreShowcase(client: SupabaseClient, input: unknown) {
  const c = showcaseCommand.parse(input)
  const r = await client.rpc('set_store_showcase', {
    p_tenant: c.tenantId,
    p_label: c.label,
  })
  if (r.error) throw new Error(aiCreditsErrorCode(r.error.message))
  return aiPlatformSettings.parse(r.data)
}

// Public: the offer and real, anonymous figures for the marketing site.
export const publicPricing = z.object({
  includedOre: z.number().int(),
  packOre: z.number().int(),
  estimatedItemsPerMonth: z.number().int(),
  measured: z.boolean(),
  stores: z.array(
    z.object({
      label: z.string(),
      itemsPerMonth: z.number().int(),
      costOre: z.number().int(),
    }),
  ),
})
export type PublicPricing = z.infer<typeof publicPricing>
export async function readPublicPricing(client: SupabaseClient) {
  const r = await client.rpc('public_pricing')
  if (r.error) throw new Error('NOT_AVAILABLE')
  return publicPricing.parse(r.data)
}

export const aiCreditsErrorCodes = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'INVALID_INPUT',
  'NOT_AVAILABLE',
  'STRIPE_NOT_CONFIGURED',
  'STRIPE_REQUEST_FAILED',
  'CREDENTIAL_KEY_MISSING',
  'AI_CREDITS_EXHAUSTED',
  'AI_CAP_REACHED',
] as const
export function aiCreditsErrorCode(message: string) {
  return (
    aiCreditsErrorCodes.find((c) => message.includes(c)) ?? 'REQUEST_FAILED'
  )
}
