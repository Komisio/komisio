import {
  centralAddressCommand,
  executeCentralShippingAddress,
} from '@/lib/engine/central-shipping-address'
import {
  mobileJson,
  mobileOrigin,
  mobilePhoneClient,
  MobileRequestError,
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
    const c = centralAddressCommand.safeParse(await mobileJson(request))
    if (!c.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobilePhoneClient(request)
    return Response.json(await executeCentralShippingAddress(client, c.data), {
      headers: externalItemHeaders(origin),
    })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
