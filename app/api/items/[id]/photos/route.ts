import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import {
  changeItemPhoto,
  itemPhotoCommand,
  readItemPhotoBytes,
} from '@/lib/engine/item-photos'
import { photoLimit } from '@/lib/media/reception-photo'
import { z } from 'zod'

type Context = { params: Promise<{ id: string }> }
const reply = (body: object, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
export async function POST(request: Request, { params }: Context) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const q = new URL(request.url).searchParams
    const parsed = itemPhotoCommand.safeParse({
      ...Object.fromEntries(q),
      itemId: (await params).id,
    })
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    const c = parsed.data
    if (ctx.active?.id !== c.tenantId)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let bytes: Uint8Array | undefined
    if (c.action === 'add') {
      const reader = request.body?.getReader()
      if (!reader) return reply({ error: 'INVALID_IMAGE' }, 400)
      const chunks: Uint8Array[] = []
      let size = 0
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
      bytes = Buffer.concat(chunks)
    }
    return reply(await changeItemPhoto(ctx.client, c, bytes))
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    const known = [
      'FORBIDDEN',
      'ITEM_NOT_FOUND',
      'ITEM_PHOTOS_CHANGED',
      'REQUEST_CONFLICT',
      'PHOTO_LIMIT',
      'PHOTO_NOT_FOUND',
      'INVALID_IMAGE',
    ]
    return reply(
      { error: known.includes(code) ? code : 'PHOTO_UPLOAD_FAILED' },
      code === 'FORBIDDEN' ? 403 : 409,
    )
  }
}
export async function GET(request: Request, { params }: Context) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const q = new URL(request.url).searchParams
    const c = z
      .object({ tenant: z.uuid(), item: z.guid(), photo: z.guid() })
      .parse({
        tenant: q.get('tenant'),
        item: (await params).id,
        photo: q.get('photo'),
      })
    if (ctx.active?.id !== c.tenant)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const photo = await readItemPhotoBytes(
      ctx.client,
      c.tenant,
      c.item,
      c.photo,
    )
    if (!photo) return reply({ error: 'NOT_FOUND' }, 404)
    return new Response(Buffer.from(photo.bytes), {
      headers: {
        'Content-Type': photo.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return reply({ error: 'NOT_FOUND' }, 404)
  }
}
