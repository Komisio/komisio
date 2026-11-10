import {
  externalItemCommand,
  executeExternalItemCommand,
} from '@/lib/engine/external-item-requests'
import {
  MobileRequestError,
  mobileJson,
  mobileOrigin,
  mobilePhoneClient,
} from '@/lib/platform/mobile-seller'
import {
  externalItemsEnabled,
  externalItemHeaders,
  externalItemFailure,
  externalItemOptions,
} from '@/lib/platform/mobile-external-items'

export const OPTIONS = externalItemOptions
export async function POST(request: Request) {
  let origin: string | null = null
  if (!externalItemsEnabled())
    return Response.json(
      { error: 'NOT_FOUND' },
      { status: 404, headers: externalItemHeaders(null) },
    )
  try {
    origin = mobileOrigin(request)
    const input = externalItemCommand.safeParse(await mobileJson(request))
    if (!input.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobilePhoneClient(request)
    return Response.json(await executeExternalItemCommand(client, input.data), {
      headers: externalItemHeaders(origin),
    })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
