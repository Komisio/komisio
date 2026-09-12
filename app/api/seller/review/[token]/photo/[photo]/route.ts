import { z } from 'zod'
import { serverClient } from '@/lib/supabase/server'
import { reviewToken } from '@/lib/engine/seller-review'
import { readSellerPhoto } from '@/lib/engine/seller-review-photo'

const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; photo: string }> },
) {
  const unavailable = () => new Response(null, { status: 404, headers })
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') return unavailable()
  try {
    const p = z
      .object({ token: reviewToken, photo: z.uuid() })
      .parse(await params)
    const client = await serverClient({ 'x-komisio-review-token': p.token })
    // Both the descriptor RPC and Storage independently validate identity/MFA/link.
    const bytes = await readSellerPhoto(client, p.token, p.photo)
    if (!bytes) return unavailable()
    return new Response(Buffer.from(bytes), {
      headers: { ...headers, 'Content-Type': 'image/jpeg' },
    })
  } catch {
    return unavailable()
  }
}
