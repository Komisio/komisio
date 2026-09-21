import { NextResponse } from 'next/server'
import { platformContext } from '@/lib/platform/context'
import { saveGuideCommand, saveStoreGuide } from '@/lib/engine/store-guide'

const reply = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export async function POST(request: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    const reader = request.body?.getReader()
    if (!reader) return reply({ error: 'INVALID_INPUT' }, 400)
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 8000) {
        await reader.cancel()
        return reply({ error: 'INVALID_INPUT' }, 413)
      }
      chunks.push(value)
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = saveGuideCommand.safeParse(body)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active?.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    if (!['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    return reply({ id: await saveStoreGuide(ctx.client, parsed.data) })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (['GUIDE_CHANGED', 'REQUEST_CONFLICT'].includes(code))
      return reply({ error: code }, 409)
    if (code === 'FORBIDDEN') return reply({ error: code }, 403)
    return reply({ error: 'REQUEST_FAILED' }, 500)
  }
}
