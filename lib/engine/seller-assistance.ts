import { z } from 'zod'
import { compareSwedishPrices } from '../assistance/external-pricing'
import type { SupabaseClient } from '@supabase/supabase-js'
import { open } from '../platform/credentials'
import { generateSubmissionSuggestion } from '../assistance/submission'
import {
  submissionSuggestion,
  validateSubmissionSuggestion,
} from '../assistance/submission-suggestion'
import { locales } from '../i18n'
import { currencyCode } from './money'

export const sellerAssistanceCommand = z.strictObject({
  tenantId: z.uuid(),
  sellerId: z.uuid(),
  requestId: z.uuid(),
  photos: z.array(z.string().max(200)).min(1).max(8),
})
const contextSchema = z.object({
  webRateOre: z.number().int().min(0).max(10000).optional(),
  language: z.enum(locales),
  currency: currencyCode,
  country: z.string().nullable(),
  accepts: z.string(),
  concept: z.string(),
  goods: z.array(z.string()),
  evidence: z.array(
    z.object({
      id: z.uuid(),
      facts: z.unknown(),
      amount: z.string(),
      sold_at: z.string(),
    }),
  ),
})

/** Client must carry both seller identity and the server-only capability header. */
export async function runSellerAssistance(
  client: SupabaseClient,
  input: unknown,
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
) {
  const c = sellerAssistanceCommand.parse(input)
  if (env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai')
    throw new Error('ASSISTANCE_DISABLED')
  const configuration = await client.rpc('seller_ai_configuration', {
    p_tenant: c.tenantId,
    p_seller: c.sellerId,
  })
  if (configuration.error) throw new Error(configuration.error.message)
  const own = z
    .object({
      own: z.object({ model: z.string(), cipher: z.unknown() }).nullable(),
    })
    .parse(configuration.data).own
  const key = own
    ? z
        .object({ key: z.string().min(1) })
        .parse(open('ai-connection', own.cipher, env)).key
    : env.KOMISIO_RECEPTION_AI_KEY
  const model = own?.model ?? env.KOMISIO_RECEPTION_AI_MODEL
  if (!key || !model) throw new Error('ASSISTANCE_DISABLED')
  const configuredRate = env.KOMISIO_RESALE_WEB_SEARCH_ORE_PER_CALL
  const webRate =
    env.KOMISIO_RESALE_WEB_SEARCH === 'true'
      ? own
        ? 0
        : configuredRate && /^[1-9][0-9]{0,3}$/.test(configuredRate)
          ? Number(configuredRate)
          : null
      : null
  const start = await client.rpc('begin_seller_photo_assistance', {
    p_tenant: c.tenantId,
    p_seller: c.sellerId,
    p_id: c.requestId,
    p_photos: c.photos,
    p_model: model,
    p_web_rate: webRate,
  })
  if (start.error) throw new Error(start.error.message)
  const run = z
    .object({
      reserved: z.boolean(),
      status: z.enum(['pending', 'ready', 'failed']),
      output: submissionSuggestion.nullable(),
      context: contextSchema,
    })
    .parse(start.data)
  if (!run.reserved)
    return {
      id: c.requestId,
      status: run.status,
      output: run.output,
      currency: run.context.currency,
    }
  let searchCalls = 0
  let output = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const images: string[] = []
    for (const path of c.photos) {
      signal.throwIfAborted()
      const photo = await client.storage
        .from('seller-submission-photos')
        .download(path)
      if (photo.error || !photo.data || photo.data.size > 1048576)
        throw new Error('PHOTO_NOT_FOUND')
      images.push(
        `data:image/jpeg;base64,${Buffer.from(await photo.data.arrayBuffer()).toString('base64')}`,
      )
    }
    const result = await generateSubmissionSuggestion(
      { key, model },
      run.context,
      images,
      signal,
      transport,
    )
    usage = result.usage
    if (result.output)
      output = validateSubmissionSuggestion(result.output, run.context)
    if (
      output &&
      !output.price &&
      run.context.webRateOre !== undefined &&
      run.context.country === 'SE' &&
      run.context.currency === 'SEK'
    ) {
      try {
        const external = await compareSwedishPrices(
          { key, model },
          output.description,
          AbortSignal.any([signal, AbortSignal.timeout(25000)]),
          transport,
        )
        usage = {
          input_tokens: usage.input_tokens + external.usage.input_tokens,
          output_tokens: usage.output_tokens + external.usage.output_tokens,
        }
        searchCalls = external.searchCalls
        if (external.comparison)
          output = { ...output, externalComparison: external.comparison }
      } catch {
        /* A failed lookup never discards the photo description or invents a price. */
      }
    }
  } catch {
    /* Failed attempts retain their request identity and never fabricate output. */
  }
  const completion = {
    p_tenant: c.tenantId,
    p_seller: c.sellerId,
    p_id: c.requestId,
    p_output: output,
    p_input: usage.input_tokens,
    p_output_tokens: usage.output_tokens,
    p_web_calls: searchCalls,
  }
  let finish = await client.rpc('complete_seller_photo_assistance', completion)
  if (finish.error?.message === 'INVALID_INPUT' && output) {
    if (output.externalComparison) {
      const { externalComparison: rejected, ...base } = output
      void rejected
      output = base
    } else output = null
    finish = await client.rpc('complete_seller_photo_assistance', {
      ...completion,
      p_output: output,
    })
  }
  if (finish.error) throw new Error(finish.error.message)
  return {
    id: c.requestId,
    status: output ? ('ready' as const) : ('failed' as const),
    output,
    currency: run.context.currency,
  }
}
