import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { open } from '../platform/credentials'
import { locales } from '../i18n'
import { receptionDerivative } from '../media/reception-image'
import {
  externalPhotoSuggestion,
  generateExternalPhotoSuggestion,
} from '../assistance/external-photo'

const capability = z.string().regex(/^[a-f0-9]{64}$/)
export const guestAnalysisProof = z.strictObject({
  id: z.uuid(),
  token: capability,
})
export const guestPhotoCommand = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('read'),
    requestId: z.uuid(),
    token: capability,
  }),
  z.strictObject({
    action: z.literal('analyze'),
    requestId: z.uuid(),
    token: capability,
    tenantId: z.uuid(),
    language: z.enum(locales),
    startedAt: z.iso.datetime(),
    photos: z
      .array(
        z.strictObject({
          id: z.uuid(),
          data: z
            .string()
            .min(4)
            .max(349528)
            .regex(
              /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            ),
        }),
      )
      .min(1)
      .max(8)
      .refine((v) => new Set(v.map((p) => p.id)).size === v.length),
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
const hash = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

/** No Auth/Storage session: only bounded bytes, transient capability and server AI budget. */
export async function runGuestPhotoAnalysis(
  client: SupabaseClient,
  input: unknown,
  networkHash: string,
  signal: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch,
) {
  const c = guestPhotoCommand.parse(input)
  const tokenHash = hash(c.token)
  const read = async () => {
    const r = await client.rpc('read_guest_photo_analysis', {
      p_id: c.requestId,
      p_token_hash: tokenHash,
    })
    if (r.error) throw new Error(r.error.message)
    return resultSchema.nullable().parse(r.data)
  }
  if (c.action === 'read') return { result: await read() }
  const bytes = c.photos.map((photo) => {
    const data = Buffer.from(photo.data, 'base64')
    if (
      !data.length ||
      data.length > 262144 ||
      data.toString('base64') !== photo.data
    )
      throw new Error('INVALID_IMAGE')
    return data
  })
  const inputHash = hash(
    JSON.stringify([
      c.tenantId,
      c.language,
      c.startedAt,
      c.photos.map((p, i) => [p.id, hash(bytes[i])]),
    ]),
  )
  if (env.KOMISIO_RECEPTION_AI_PROVIDER !== 'openai')
    throw new Error('ASSISTANCE_DISABLED')
  const config = await client.rpc('guest_photo_ai_configuration', {
    p_tenant: c.tenantId,
  })
  if (config.error) throw new Error(config.error.message)
  const own = z
    .object({
      own: z.object({ model: z.string(), cipher: z.unknown() }).nullable(),
    })
    .parse(config.data).own
  const key = own
    ? z
        .object({ key: z.string().min(1) })
        .parse(open('ai-connection', own.cipher, env)).key
    : env.KOMISIO_RECEPTION_AI_KEY
  const model = own?.model ?? env.KOMISIO_RECEPTION_AI_MODEL
  if (!key || !model) throw new Error('ASSISTANCE_DISABLED')
  const begin = await client.rpc('begin_guest_photo_analysis', {
    p_id: c.requestId,
    p_tenant: c.tenantId,
    p_token_hash: tokenHash,
    p_network_hash: networkHash,
    p_input_hash: inputHash,
    p_photos: c.photos.map((p) => p.id),
    p_language: c.language,
    p_model: model,
    p_started_at: c.startedAt,
  })
  if (begin.error) throw new Error(begin.error.message)
  const started = z
    .object({ reserved: z.boolean(), result: resultSchema })
    .parse(begin.data)
  if (!started.reserved) return { result: started.result }
  // Reserve limits before image decoding or model work. Invalid images consume
  // an attempt, and an interrupted provider result is never dispatched again.
  const evidence: string[] = []
  let output = null
  let usage = { input_tokens: 0, output_tokens: 0 }
  try {
    const images: string[] = []
    for (const data of bytes) {
      signal.throwIfAborted()
      const normalized = await receptionDerivative(data)
      evidence.push(hash(normalized))
      images.push(`data:image/jpeg;base64,${normalized.toString('base64')}`)
    }
    const reply = await generateExternalPhotoSuggestion(
      { key, model },
      c.language,
      images,
      signal,
      transport,
    )
    output = reply.output
    usage = reply.usage
  } catch {
    /* Persist the failed attempt; never log images or capabilities. */
  }
  const finish = await client.rpc('complete_guest_photo_analysis', {
    p_id: c.requestId,
    p_token_hash: tokenHash,
    p_evidence: evidence,
    p_output: output,
    p_input: usage.input_tokens,
    p_output_tokens: usage.output_tokens,
  })
  if (finish.error) throw new Error(finish.error.message)
  const result = await read()
  if (!result || result.status === 'pending')
    throw new Error('UNCONFIRMED_RESULT')
  return { result }
}

export async function adoptGuestPhotoAnalysis(
  client: SupabaseClient,
  proof: z.infer<typeof guestAnalysisProof>,
  tenant: string,
  photos: string[],
) {
  const r = await client.rpc('adopt_guest_photo_analysis', {
    p_id: proof.id,
    p_token_hash: hash(proof.token),
    p_tenant: tenant,
    p_photos: photos,
  })
  if (r.error) throw new Error(r.error.message)
  z.uuid().nullable().parse(r.data)
}
