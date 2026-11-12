import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { open } from '../platform/credentials'
import { locales } from '../i18n'
import {
  externalPhotoSuggestion,
  generateExternalPhotoSuggestion,
} from '../assistance/external-photo'

export const externalPhotoAnalysisCommand = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('read'), requestId: z.uuid() }),
  z.strictObject({
    action: z.literal('analyze'),
    requestId: z.uuid(),
    tenantId: z.uuid(),
    language: z.enum(locales),
    photos: z
      .array(z.uuid())
      .min(1)
      .max(8)
      .refine((v) => new Set(v).size === v.length),
  }),
])
const resultSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  photos: z.array(z.uuid()).min(1).max(8),
  language: z.enum(locales),
  status: z.enum(['pending', 'ready', 'failed']),
  output: externalPhotoSuggestion.nullable(),
})
export async function readExternalPhotoAnalysis(
  client: SupabaseClient,
  id: string,
) {
  const result = await client.rpc('my_external_photo_analysis', { p_id: id })
  if (result.error) throw new Error(result.error.message)
  return resultSchema.nullable().parse(result.data)
}
export async function runExternalPhotoAnalysis(
  client: SupabaseClient,
  input: unknown,
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
) {
  const c = externalPhotoAnalysisCommand.parse(input)
  const prior = await readExternalPhotoAnalysis(client, c.requestId)
  if (c.action === 'read') return { result: prior }
  if (prior) {
    if (
      prior.tenantId !== c.tenantId ||
      prior.language !== c.language ||
      JSON.stringify(prior.photos) !== JSON.stringify(c.photos)
    )
      throw new Error('REQUEST_CONFLICT')
    return { result: prior }
  }
  if (env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai')
    throw new Error('ASSISTANCE_DISABLED')
  const configuration = await client.rpc('external_photo_ai_configuration', {
    p_tenant: c.tenantId,
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
  const start = await client.rpc('begin_external_photo_analysis', {
    p_id: c.requestId,
    p_tenant: c.tenantId,
    p_photos: c.photos,
    p_model: model,
    p_language: c.language,
  })
  if (start.error) throw new Error(start.error.message)
  const run = z
    .object({
      reserved: z.boolean(),
      result: resultSchema,
      evidence: z
        .array(
          z.object({
            id: z.uuid(),
            path: z.string().regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        )
        .min(1)
        .max(8),
    })
    .parse(start.data)
  if (!run.reserved) return { result: run.result }
  let output = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const images: string[] = []
    for (const photo of run.evidence) {
      signal.throwIfAborted()
      const downloaded = await client.storage
        .from('external-item-photos')
        .download(photo.path)
      if (
        downloaded.error ||
        !downloaded.data ||
        downloaded.data.size > 1048576
      )
        throw new Error('PHOTO_NOT_FOUND')
      const bytes = Buffer.from(await downloaded.data.arrayBuffer())
      if (createHash('sha256').update(bytes).digest('hex') !== photo.sha256)
        throw new Error('PHOTO_NOT_FOUND')
      images.push(`data:image/jpeg;base64,${bytes.toString('base64')}`)
    }
    const response = await generateExternalPhotoSuggestion(
      { key, model },
      c.language,
      images,
      signal,
      transport,
    )
    output = response.output
    usage = response.usage
  } catch {
    /* Persist failure; a lost response never dispatches a second model call. */
  }
  const finish = await client.rpc('complete_external_photo_analysis', {
    p_id: c.requestId,
    p_output: output,
    p_input: usage.input_tokens,
    p_output_tokens: usage.output_tokens,
  })
  if (finish.error) throw new Error(finish.error.message)
  const result = await readExternalPhotoAnalysis(client, c.requestId)
  if (!result || result.status === 'pending')
    throw new Error('UNCONFIRMED_RESULT')
  return { result }
}
