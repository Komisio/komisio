import {
  mobileSellerCommand,
  executeMobileSellerCommand,
} from '@/lib/engine/mobile-seller-command'
import {
  MobileRequestError,
  mobileJson,
  mobileOrigin,
  mobileSellerClient,
} from '@/lib/platform/mobile-seller'

function enabled() {
  return (
    process.env.KOMISIO_INTAKE_ENABLED === 'true' &&
    process.env.KOMISIO_MOBILE_API_ENABLED === 'true'
  )
}
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
  const message =
    error instanceof Error
      ? error.message
      : (error as { message?: unknown } | null)?.message
  const codes: Record<string, number> = {
    AUTH_REQUIRED: 401,
    FORBIDDEN: 403,
    INVALID_INPUT: 400,
    REQUEST_CONFLICT: 409,
    BANK_DETAILS_CHANGED: 409,
    AGREEMENT_CHANGED: 409,
    PAYOUT_BELOW_THRESHOLD: 409,
    PAYOUT_EXCEEDS_BALANCE: 409,
    SELLER_CLOSED: 409,
  }
  const known = typeof message === 'string' && Object.hasOwn(codes, message)
  return Response.json(
    { error: known ? message : 'REQUEST_FAILED' },
    {
      status: known ? codes[message] : 503,
      headers: headers(origin),
    },
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
    const parsed = mobileSellerCommand.safeParse(await mobileJson(request))
    if (!parsed.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobileSellerClient(
      request,
      parsed.data.tenantId,
      parsed.data.sellerId,
    )
    return Response.json(
      await executeMobileSellerCommand(client, parsed.data),
      { headers: headers(origin) },
    )
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
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    if (
      !origin ||
      request.headers.get('access-control-request-method') !== 'POST' ||
      requested.some(
        (name) => !['authorization', 'content-type'].includes(name),
      )
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
