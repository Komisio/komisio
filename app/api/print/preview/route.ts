import { NextResponse } from 'next/server'
import { z } from 'zod'
import { platformContext } from '@/lib/platform/context'
import { boundedJson } from '@/lib/http/bounded-json'
import { labelFormatKind, readLabelFormats } from '@/lib/engine/printing'
import { referenceFormat, renderLabel } from '@/lib/labels/templates'
import { renderStoreTemplate, sampleFacts } from '@/lib/labels/placeholders'

/**
 * A picture of a label: the ZPL (a store template or the built-in layout)
 * with sample facts, rendered by Labelary (api.labelary.com), a public
 * ZPL renderer. Only sample data ever leaves; no store data, no
 * credentials. Owner or admin, for the editor.
 */
export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    NextResponse.json(body, {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true')
    return reply({ error: 'NOT_FOUND' }, 404)
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin || request.headers.get('origin') !== new URL(origin).origin)
    return reply({ error: 'FORBIDDEN' }, 403)
  try {
    const ctx = await platformContext()
    if (!ctx || ctx.mfaRequired) return reply({ error: 'AUTH_REQUIRED' }, 401)
    if (!ctx.active || !['owner', 'admin'].includes(ctx.active.role))
      return reply({ error: 'FORBIDDEN' }, 403)
    let input: unknown
    try {
      input = await boundedJson(request, 32768)
    } catch {
      return reply({ error: 'INVALID_INPUT' }, 400)
    }
    const parsed = z
      .strictObject({
        tenantId: z.uuid(),
        kind: labelFormatKind,
        zpl: z.string().min(4).max(20000).nullable(),
        dpi: z
          .union([z.literal(203), z.literal(300), z.literal(600)])
          .default(203),
      })
      .safeParse(input)
    if (!parsed.success) return reply({ error: 'INVALID_INPUT' }, 400)
    if (parsed.data.tenantId !== ctx.active.id)
      return reply({ error: 'TENANT_CHANGED' }, 409)
    const formats = await readLabelFormats(ctx.client, ctx.active.id)
    const size = formats?.[parsed.data.kind] ?? referenceFormat
    const format = {
      widthMm: size.widthMm,
      heightMm: size.heightMm,
      dpi: parsed.data.dpi,
    }
    const facts = sampleFacts(parsed.data.kind)
    const zpl = parsed.data.zpl
      ? renderStoreTemplate(parsed.data.zpl, facts, format)
      : renderLabel(parsed.data.kind, facts, format)
    const dpmm = Math.round(parsed.data.dpi / 25.4)
    const inches = (mm: number) => (mm / 25.4).toFixed(2)
    const response = await fetch(
      `https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${inches(size.widthMm)}x${inches(size.heightMm)}/0/`,
      {
        method: 'POST',
        headers: {
          Accept: 'image/png',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: zpl,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      },
    )
    if (!response.ok) return reply({ error: 'PREVIEW_UNAVAILABLE', zpl }, 502)
    const png = Buffer.from(await response.arrayBuffer())
    if (png.length > 2_000_000)
      return reply({ error: 'PREVIEW_UNAVAILABLE', zpl }, 502)
    return reply({
      image: `data:image/png;base64,${png.toString('base64')}`,
      zpl,
    })
  } catch {
    return reply({ error: 'PREVIEW_UNAVAILABLE' }, 502)
  }
}
