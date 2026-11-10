import { MobileRequestError, mobileOrigin } from './mobile-seller'

export function externalItemsEnabled() {
  return (
    process.env.KOMISIO_INTAKE_ENABLED === 'true' &&
    process.env.KOMISIO_MOBILE_API_ENABLED === 'true'
  )
}
export function externalItemHeaders(origin: string | null) {
  return {
    'Cache-Control': 'private, no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  }
}
export function externalItemFailure(error: unknown, origin: string | null) {
  if (error instanceof MobileRequestError)
    return Response.json(
      { error: error.code },
      { status: error.status, headers: externalItemHeaders(origin) },
    )
  const message = error instanceof Error ? error.message : ''
  const statuses: Record<string, number> = {
    PHONE_VERIFICATION_REQUIRED: 403,
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    SUPPORT_READ_ONLY: 403,
    INVALID_INPUT: 400,
    INVALID_PHOTO: 400,
    INVALID_IMAGE: 400,
    ASSISTANCE_IMAGE_TOO_LARGE: 413,
    PHOTO_TOO_LARGE: 413,
    REQUEST_CONFLICT: 409,
    ACTIVE_REQUEST_LIMIT: 409,
    PHOTO_LIMIT: 409,
    STORE_UNAVAILABLE: 409,
    STORE_CHANGED: 409,
    PHOTO_NOT_FOUND: 409,
    PHOTO_IN_USE: 409,
    PHOTO_STILL_STORED: 409,
    PLAN_READ_ONLY: 409,
  }
  const known = Object.hasOwn(statuses, message)
  return Response.json(
    { error: known ? message : 'REQUEST_FAILED' },
    {
      status: known ? statuses[message] : 503,
      headers: externalItemHeaders(origin),
    },
  )
}
export function externalItemOptions(request: Request) {
  let origin: string | null = null
  if (!externalItemsEnabled())
    return new Response(null, {
      status: 404,
      headers: externalItemHeaders(null),
    })
  try {
    origin = mobileOrigin(request)
    const requested = (
      request.headers.get('access-control-request-headers') ?? ''
    )
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
    if (
      !origin ||
      request.headers.get('access-control-request-method') !== 'POST' ||
      requested.some((v) => !['authorization', 'content-type'].includes(v))
    )
      throw new MobileRequestError('FORBIDDEN', 403)
    return new Response(null, {
      status: 204,
      headers: {
        ...externalItemHeaders(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}

/** Bound the stream before allocating the decoded image; Content-Length is untrusted. */
export async function externalPhotoBytes(request: Request) {
  if (
    !['image/jpeg', 'image/png'].includes(
      request.headers.get('content-type')?.split(';')[0].trim() ?? '',
    )
  )
    throw new MobileRequestError('INVALID_PHOTO', 415)
  const reader = request.body?.getReader()
  if (!reader) throw new MobileRequestError('INVALID_PHOTO', 400)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 3 * 1024 * 1024) {
        await reader.cancel()
        throw new MobileRequestError('PHOTO_TOO_LARGE', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
