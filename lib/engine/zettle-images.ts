import sharp from 'sharp'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  connectedPilotImages,
  pilotAvailable,
  pilotEnvironment,
  type PilotEnvironment,
} from '../../extensions/zettle/auth'
import { zettleImageUrl } from '../../extensions/zettle/images'
import { catalogProduct } from '../../extensions/zettle/catalog'
import { photoLimit } from '../media/reception-photo'
import { receptionDerivative } from '../media/reception-image'

export async function readZettleImageUrl(
  client: SupabaseClient,
  tenantId: string,
  itemId: string,
) {
  const result = await client.rpc('zettle_item_image_url', {
    p_tenant: z.uuid().parse(tenantId),
    p_item: z.guid().parse(itemId),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('ZETTLE_READ_FAILED')
  return zettleImageUrl.nullable().parse(result.data)
}

export async function readZettleImages(
  client: SupabaseClient,
  tenantId: string,
) {
  const result = await client.rpc('zettle_image_status_v2', {
    p_tenant: z.uuid().parse(tenantId),
  })
  if (result.error?.code === 'PGRST202') return null
  if (result.error) throw new Error('ZETTLE_READ_FAILED')
  return z
    .array(
      z.object({
        item_id: z.guid(),
        status: z.enum(['synced', 'uploaded', 'held']),
      }),
    )
    .max(50)
    .parse(result.data)
}

export async function exportZettleImage(
  client: SupabaseClient,
  tenantId: string,
  requestId: string,
  itemId: string,
  source: PilotEnvironment,
  factory = connectedPilotImages,
) {
  for (const id of [tenantId, requestId, itemId]) z.uuid().parse(id)
  const role = await client.rpc('tenant_role', { p_tenant: tenantId })
  if (role.error || !['owner', 'admin'].includes(role.data ?? ''))
    throw new Error('FORBIDDEN')
  const env = pilotEnvironment(source)
  if (!pilotAvailable(tenantId, env) || !env.ZETTLE_MERCHANT_ID)
    throw new Error('ZETTLE_NOT_CONNECTED')
  const parameters = {
    p_tenant: tenantId,
    p_id: requestId,
    p_item: itemId,
    p_merchant: env.ZETTLE_MERCHANT_ID,
  }
  const prepared = await client.rpc('prepare_zettle_image', parameters)
  if (prepared.error) throw new Error(prepared.error.message)
  if (prepared.data === null)
    return { id: requestId, image: 'no_photo' as const }
  const claim = z
    .object({
      id: z.uuid(),
      fresh: z.boolean(),
      exportId: z.uuid(),
      reference: z
        .string()
        .regex(/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png)$/),
    })
    .parse(prepared.data)
  if (!claim.reference.startsWith(`${tenantId}/`))
    throw new Error('ZETTLE_IMAGE_INVALID')
  let url = await readZettleImageUrl(client, tenantId, itemId)
  if (!url && !claim.fresh) throw new Error('ZETTLE_IMAGE_HELD')
  const remote = await factory(tenantId, env)
  const requireCurrent = async () => {
    const current = await client.rpc('prepare_zettle_image', parameters)
    if (current.error) throw new Error(current.error.message)
    if (
      current.data?.exportId !== claim.exportId ||
      current.data?.id !== claim.id ||
      current.data?.reference !== claim.reference
    )
      throw new Error('ZETTLE_CONFIG_CHANGED')
  }
  if (!url) {
    const downloaded = await client.storage
      .from('reception-photos')
      .download(claim.reference)
    if (
      downloaded.error ||
      !downloaded.data ||
      downloaded.data.size > photoLimit
    )
      throw new Error('ZETTLE_IMAGE_INVALID')
    let bytes: Buffer
    try {
      bytes = await receptionDerivative(
        new Uint8Array(await downloaded.data.arrayBuffer()),
      )
      const metadata = await sharp(bytes).metadata()
      if ((metadata.width ?? 0) <= 50 || (metadata.height ?? 0) <= 50)
        throw new Error('small')
    } catch {
      throw new Error('ZETTLE_IMAGE_INVALID')
    }
    await requireCurrent()
    url = zettleImageUrl.parse(await remote.uploadImage(bytes))
    const saved = await client.rpc('record_zettle_image_upload', {
      p_tenant: tenantId,
      p_intent: claim.id,
      p_url: url,
    })
    if (saved.error) throw new Error('ZETTLE_OUTCOME_FAILED')
  }
  const stored = await client
    .from('zettle_product_exports')
    .select('payload')
    .eq('tenant_id', tenantId)
    .eq('id', claim.exportId)
    .single()
  if (stored.error) throw new Error('ZETTLE_READ_FAILED')
  const product = catalogProduct.parse(stored.data.payload)
  await requireCurrent()
  await remote.putProduct(product, product, url)
  const finished = await client.rpc('finish_zettle_image', {
    p_tenant: tenantId,
    p_intent: claim.id,
  })
  if (finished.error) throw new Error('ZETTLE_OUTCOME_FAILED')
  return { id: requestId, image: 'synced' as const }
}
