import { deletionCommand, executeDeletion } from '@/lib/engine/account-deletion'
import {
  mobileAccountClient,
  mobileJson,
  mobileOrigin,
  MobileRequestError,
} from '@/lib/platform/mobile-seller'
import {
  deletionFailure,
  deletionHeaders,
} from '@/lib/platform/account-deletion-http'

export async function POST(request: Request) {
  let origin: string | null = null
  try {
    origin = mobileOrigin(request)
    const command = deletionCommand.safeParse(await mobileJson(request))
    if (!command.success) throw new MobileRequestError('INVALID_INPUT', 400)
    return Response.json(
      await executeDeletion(await mobileAccountClient(request), command.data),
      { headers: deletionHeaders(origin) },
    )
  } catch (error) {
    return deletionFailure(error, origin)
  }
}
export async function OPTIONS(request: Request) {
  let origin: string | null = null
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
        ...deletionHeaders(origin),
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  } catch (error) {
    return deletionFailure(error, origin)
  }
}
