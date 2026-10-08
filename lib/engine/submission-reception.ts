import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uploadReceptionPhoto, photoLimit } from './reception-photos'
import { readReceptionSession } from './reception-store'
import { exactPrice } from './manual-reception'
export const prepareSubmissionCommand = z.strictObject({
  tenantId: z.uuid(),
  submissionId: z.uuid(),
  description: z.string().trim().min(1).max(1000),
  price: z.string().transform(exactPrice),
})
export async function prepareSubmissionReception(
  client: SupabaseClient,
  input: unknown,
) {
  const c = prepareSubmissionCommand.parse(input)
  const started = await client.rpc('prepare_submission_reception', {
    p_tenant: c.tenantId,
    p_submission: c.submissionId,
  })
  if (started.error) throw new Error(started.error.message)
  const sessionId = z.uuid().parse(started.data)
  const state = await readReceptionSession(client, c.tenantId, sessionId)
  if (
    state?.status === 'ready' ||
    (state?.status === 'empty' && state.revision > 0)
  )
    return { sessionId }
  const proposal = await client
    .from('seller_submissions')
    .select('photos')
    .eq('tenant_id', c.tenantId)
    .eq('id', c.submissionId)
    .single()
  if (proposal.error) throw new Error('SUBMISSION_NOT_FOUND')
  for (const path of z
    .array(z.string())
    .min(1)
    .max(8)
    .parse(proposal.data.photos)) {
    const source = await client.storage
      .from('seller-submission-photos')
      .download(path)
    if (source.error || source.data.size > photoLimit)
      throw new Error('PHOTO_NOT_FOUND')
    await uploadReceptionPhoto(
      client,
      {
        tenantId: c.tenantId,
        sessionId,
        photoId: path.split('/')[2].replace(/\.jpg$/, ''),
      },
      new Uint8Array(await source.data.arrayBuffer()),
    )
  }
  const result = await client.rpc('complete_submission_reception', {
    p_tenant: c.tenantId,
    p_submission: c.submissionId,
    p_description: c.description,
    p_price: c.price,
  })
  if (result.error) throw new Error(result.error.message)
  if (result.data !== sessionId) throw new Error('UNCONFIRMED_RESULT')
  return { sessionId }
}
