import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { externalItemsEnabled } from '@/lib/platform/mobile-external-items'

const headers = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}
export async function GET(request: Request) {
  if (!externalItemsEnabled())
    return new Response(null, { status: 404, headers })
  const ctx = await platformContext()
  if (!ctx?.active || ctx.mfaRequired)
    return new Response(null, { status: 403, headers })
  const params = new URL(request.url).searchParams
  const id = z.uuid().safeParse(params.get('request')),
    photo = z.uuid().safeParse(params.get('photo'))
  if (!id.success || !photo.success)
    return new Response(null, { status: 404, headers })
  const r = await ctx.client
    .from('external_item_requests')
    .select('owner_id,photos')
    .eq('tenant_id', ctx.active.id)
    .eq('id', id.data)
    .maybeSingle()
  if (r.error || !r.data?.photos.includes(photo.data))
    return new Response(null, { status: 404, headers })
  const image = await ctx.client.storage
    .from('external-item-photos')
    .download(`${r.data.owner_id}/${photo.data}.jpg`)
  if (image.error || !image.data || image.data.size > 1048576)
    return new Response(null, { status: 404, headers })
  return new Response(image.data, {
    headers: { ...headers, 'Content-Type': 'image/jpeg' },
  })
}
