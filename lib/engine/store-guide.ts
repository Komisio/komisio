import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const guideOptions = {
  intake: ['single', 'bags', 'owned', 'new', 'pickup', 'space', 'other'],
  goods: ['clothes', 'kids', 'home', 'furniture', 'hobby', 'mixed', 'other'],
  pricing: ['store', 'together', 'seller', 'suggestion', 'both', 'later'],
  period: ['collect', 'donate', 'extend', 'individual', 'later'],
  pos: ['zettle', 'shopify', 'other', 'later'],
  channels: ['shop', 'web', 'social', 'market', 'later'],
} as const
export type GuideKey = keyof typeof guideOptions
export type GuideAnswers = Record<GuideKey, string[]>
export const emptyGuide = (): GuideAnswers => ({
  intake: [],
  goods: [],
  pricing: [],
  period: [],
  pos: [],
  channels: [],
})
export const hasConsignment = (a: GuideAnswers) =>
  a.intake.some((x) => ['single', 'bags', 'pickup'].includes(x))
export const rentalOnly = (a: GuideAnswers) =>
  a.intake.includes('space') &&
  !hasConsignment(a) &&
  !a.intake.some((x) => ['owned', 'new'].includes(x))
export function pricingOptions(a: GuideAnswers): string[] {
  return rentalOnly(a)
    ? ['store', 'seller', 'both', 'later']
    : hasConsignment(a)
      ? ['store', 'together', 'seller', 'later']
      : ['store', 'suggestion', 'later']
}
export function guideSteps(a: GuideAnswers): GuideKey[] {
  return [
    'intake',
    'goods',
    'pricing',
    ...(hasConsignment(a) ? ['period' as const] : []),
    'pos',
    'channels',
  ] as GuideKey[]
}
const choices = (options: readonly string[], min = 1, max = 7) =>
  z
    .array(z.string().refine((v) => options.includes(v)))
    .min(min)
    .max(max)
    .refine(
      (a) =>
        new Set(a).size === a.length &&
        (!a.includes('later') || a.length === 1),
    )
export const guideAnswers = z
  .strictObject({
    intake: choices(guideOptions.intake),
    goods: choices(guideOptions.goods),
    pricing: choices(guideOptions.pricing, 1, 1),
    period: choices(guideOptions.period, 0),
    pos: choices(guideOptions.pos, 1, 1),
    channels: choices(guideOptions.channels),
  })
  .refine(
    (a) =>
      hasConsignment(a) === a.period.length > 0 &&
      a.pricing.every((v) => pricingOptions(a).includes(v)),
  )
export const saveGuideCommand = z.strictObject({
  tenantId: z.uuid(),
  requestId: z.uuid(),
  expectedCurrentId: z.uuid().nullable(),
  answers: guideAnswers,
})
const currentGuide = z.object({
  id: z.uuid().nullable(),
  version: z.number().int(),
  answers: guideAnswers.nullable(),
  savedAt: z.string().nullable(),
})
export type CurrentGuide = z.infer<typeof currentGuide>
export async function readStoreGuide(client: SupabaseClient, tenantId: string) {
  const result = await client.rpc('current_store_guide', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error) throw new Error('REQUEST_FAILED')
  return currentGuide.parse(result.data)
}
export async function saveStoreGuide(client: SupabaseClient, input: unknown) {
  const c = saveGuideCommand.parse(input)
  const result = await client.rpc('save_store_guide', {
    p_tenant: c.tenantId,
    p_id: c.requestId,
    p_expected_current: c.expectedCurrentId,
    p_answers: c.answers,
  })
  if (result.error)
    throw new Error(
      ['FORBIDDEN', 'GUIDE_CHANGED', 'REQUEST_CONFLICT', 'INVALID_INPUT'].find(
        (x) => result.error!.message === x,
      ) ?? 'REQUEST_FAILED',
    )
  return z.uuid().parse(result.data)
}
