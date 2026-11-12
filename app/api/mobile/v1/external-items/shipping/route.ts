import { centralParcelCommand } from '@/lib/engine/central-parcel-schema'
import { executeCentralParcel } from '@/lib/engine/central-parcels'
import { postNordConfiguration } from '@/lib/platform/postnord'
import {
  mobileJson,
  mobileOrigin,
  mobilePhoneClient,
  mobileShippingClient,
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
    const c = centralParcelCommand.safeParse(await mobileJson(request))
    if (!c.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const config = postNordConfiguration()
    const client =
      c.data.action === 'book' && config
        ? await mobileShippingClient(request, config.serverKey)
        : await mobilePhoneClient(request)
    return Response.json(await executeCentralParcel(client, c.data, config), {
      headers: externalItemHeaders(origin),
    })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
