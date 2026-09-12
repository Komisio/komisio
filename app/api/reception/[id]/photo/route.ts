import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import {
  photoLimit,
  uploadReceptionPhoto,
  readReceptionPhoto,
} from '@/lib/engine/reception-photos'
const ids = z.object({ id: z.uuid(), photo: z.uuid(), tenant: z.uuid() })
type RouteContext = { params: Promise<{ id: string }> }
const reply = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(request: Request, { params }: RouteContext) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const url = new URL(request.url),
      c = ids.safeParse({
        id: (await params).id,
        photo: url.searchParams.get('photo'),
        tenant: url.searchParams.get('tenant'),
      })
    if (!c.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (ctx.active?.id !== c.data.tenant)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (ctx.active.role === 'readonly')
      return reply({ error: 'FORBIDDEN' }, 403)
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
    const source = await uploadReceptionPhoto(
      ctx.client,
      { tenantId: c.data.tenant, sessionId: c.data.id, photoId: c.data.photo },
      Buffer.concat(chunks),
    )
    return reply({ source }, 200)
  } catch {
    return reply({ error: 'PHOTO_UPLOAD_FAILED' }, 400)
  }
}
export async function GET(request: Request, { params }: RouteContext) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const c = ids.safeParse({
      id: (await params).id,
      photo: new URL(request.url).searchParams.get('photo'),
      tenant: ctx.active?.id,
    })
    if (!c.success) return reply({ error: 'NOT_FOUND' }, 404)
    const photo = await readReceptionPhoto(ctx.client, {
      tenantId: c.data.tenant,
      sessionId: c.data.id,
      photoId: c.data.photo,
    })
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
