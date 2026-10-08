import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { photoLimit } from '@/lib/media/reception-photo'
import { uploadSellerSubmissionPhoto } from '@/lib/engine/seller-submissions'
const ids = z.object({ seller: z.uuid(), photo: z.uuid(), tenant: z.uuid() })
const reply = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(request: Request) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const url = new URL(request.url),
      c = ids.safeParse({
        seller: new URL(request.url).searchParams.get('seller'),
        photo: url.searchParams.get('photo'),
        tenant: url.searchParams.get('tenant'),
      })
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const reader = request.body?.getReader()
    if (!reader) return reply({ error: 'INVALID_IMAGE' }, 400)
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > photoLimit) {
        await reader.cancel()
        return reply({ error: 'IMAGE_TOO_LARGE' }, 413)
      }
      chunks.push(value)
    }
    const source = await uploadSellerSubmissionPhoto(
      ctx.client,
      {
        tenantId: c.data.tenant,
        sellerId: c.data.seller,
        photoId: c.data.photo,
      },
      Buffer.concat(chunks),
    )
    return reply({ source }, 200)
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_IMAGE')
      return reply({ error: 'INVALID_IMAGE' }, 400)
    return reply({ error: 'PHOTO_UPLOAD_FAILED' }, 400)
  }
}
export async function GET(request: Request) {
  if (process.env.KOMISIO_SELLER_SUBMISSIONS_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const c = ids.safeParse({
      seller: new URL(request.url).searchParams.get('seller'),
      photo: new URL(request.url).searchParams.get('photo'),
      tenant: new URL(request.url).searchParams.get('tenant'),
    })
    if (!c.success) return reply({ error: 'NOT_FOUND' }, 404)
    const path = `${c.data.tenant}/${c.data.seller}/${c.data.photo}.jpg`
    const photo = await ctx.client.storage
      .from('seller-submission-photos')
      .download(path)
    if (photo.error || photo.data.size > 1048576)
      return reply({ error: 'NOT_FOUND' }, 404)
    return new Response(Buffer.from(await photo.data.arrayBuffer()), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return reply({ error: 'NOT_FOUND' }, 404)
  }
}
