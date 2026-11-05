import { executePushDevice, pushDeviceCommand } from '@/lib/engine/seller-push'
import {
  MobileRequestError,
  mobileIdentityClient,
  mobileJson,
  mobileOrigin,
} from '@/lib/platform/mobile-seller'

const enabled = () =>
  process.env.KOMISIO_INTAKE_ENABLED === 'true' &&
  process.env.KOMISIO_MOBILE_API_ENABLED === 'true'
function headers(origin: string | null) {
  return {
    'Cache-Control': 'private, no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  }
}
function failure(error: unknown, origin: string | null) {
  if (error instanceof MobileRequestError)
    return Response.json(
      { error: error.code },
      { status: error.status, headers: headers(origin) },
    )
  const raw = error as { message?: unknown } | null
  const codes: Record<string, number> = {
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    PASSWORD_UPDATE_REQUIRED: 409,
    INVALID_INPUT: 400,
    REQUEST_CONFLICT: 409,
    PUSH_DEVICE_CHANGED: 409,
    PUSH_DEVICE_LIMIT: 409,
    PUSH_DEVICE_IN_USE: 409,
  }
  const code =
    typeof raw?.message === 'string' && Object.hasOwn(codes, raw.message)
      ? raw.message
      : 'REQUEST_FAILED'
  return Response.json(
    { error: code },
    { status: codes[code] ?? 503, headers: headers(origin) },
  )
}
export async function POST(request: Request) {
  let origin: string | null = null
  if (!enabled())
    return Response.json(
      { error: 'NOT_FOUND' },
      { status: 404, headers: headers(null) },
    )
  try {
    origin = mobileOrigin(request)
    const parsed = pushDeviceCommand.safeParse(await mobileJson(request))
    if (!parsed.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobileIdentityClient(request)
    return Response.json(await executePushDevice(client, parsed.data), {
      headers: headers(origin),
    })
  } catch (error) {
    return failure(error, origin)
  }
}
export async function OPTIONS(request: Request) {
  let origin: string | null = null
  if (!enabled())
    return new Response(null, { status: 404, headers: headers(null) })
  try {
    origin = mobileOrigin(request)
    const requested = (
      request.headers.get('access-control-request-headers') ?? ''
    )
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    if (
      !origin ||
      request.headers.get('access-control-request-method') !== 'POST' ||
      requested.some((s) => !['authorization', 'content-type'].includes(s))
    )
      throw new MobileRequestError('FORBIDDEN', 403)
    return new Response(null, {
      status: 204,
      headers: {
        ...headers(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  } catch (error) {
    return failure(error, origin)
  }
}
