import { timingSafeEqual } from 'node:crypto'
import { guestPhotoClient } from '@/lib/platform/guest-photo-client'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const headers = { 'Cache-Control': 'no-store' }
  if (!secret || secret.length < 16)
    return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers })
  const expected = Buffer.from(`Bearer ${secret}`),
    actual = Buffer.from(request.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return Response.json({ error: 'AUTH_REQUIRED' }, { status: 401, headers })
  try {
    const result = await guestPhotoClient().rpc('prune_guest_photo_analyses')
    if (result.error || !Number.isInteger(result.data))
      throw new Error('CLEANUP_FAILED')
    return Response.json({ removed: result.data }, { headers })
  } catch {
    return Response.json({ error: 'CLEANUP_FAILED' }, { status: 503, headers })
  }
}
