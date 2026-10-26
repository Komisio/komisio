import { platformContext } from '@/lib/platform/context'
import {
  lifecycleBatchCommand,
  executeLifecycleBatch,
} from '@/lib/engine/item-lifecycle-batch'

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return reply({}, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({}, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({}, 401)
    const reader = request.body?.getReader()
    if (!reader) return reply({}, 400)
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 64000) {
        await reader.cancel()
        return reply({}, 413)
      }
      chunks.push(value)
    }
    let body: unknown
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      return reply({}, 400)
    }
    const parsed = lifecycleBatchCommand.safeParse(body)
    if (!parsed.success) return reply({}, 400)
    if (ctx.active?.id !== parsed.data.tenantId) return reply({}, 409)
    if (!['owner', 'admin', 'staff'].includes(ctx.active.role))
      return reply({}, 403)
    return reply({
      ok: true,
      result: await executeLifecycleBatch(ctx.client, parsed.data),
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : ''
    return reply(
      {},
      code === 'FORBIDDEN' ? 403 : code === 'REQUEST_CONFLICT' ? 409 : 503,
    )
  }
}
