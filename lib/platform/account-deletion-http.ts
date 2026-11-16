import { MobileRequestError } from './mobile-seller'
export function deletionHeaders(origin: string | null = null) {
  return {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  }
}
export function deletionFailure(error: unknown, origin: string | null = null) {
  const codes: Record<string, number> = {
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    SUPPORT_READ_ONLY: 403,
    INVALID_INPUT: 400,
    REQUEST_CONFLICT: 409,
    REQUEST_CHANGED: 409,
    REQUEST_NOT_FOUND: 404,
    DELETION_INCOMPLETE: 409,
  }
  if (error instanceof MobileRequestError)
    return Response.json(
      { error: error.code },
      { status: error.status, headers: deletionHeaders(origin) },
    )
  const raw = error instanceof Error ? error.message : ''
  const code = Object.hasOwn(codes, raw) ? raw : 'REQUEST_FAILED'
  return Response.json(
    { error: code },
    { status: codes[code] ?? 503, headers: deletionHeaders(origin) },
  )
}
