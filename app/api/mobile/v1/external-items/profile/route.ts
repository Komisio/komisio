import {
  centralIntakeProfileCommand,
  executeCentralIntakeProfile,
} from '@/lib/engine/central-intake-profile'
import {
  mobileJson,
  mobileOrigin,
  mobileExternalIdentityClient,
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
    const c = centralIntakeProfileCommand.safeParse(await mobileJson(request))
    if (!c.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobileExternalIdentityClient(request)
    return Response.json(await executeCentralIntakeProfile(client, c.data), {
      headers: externalItemHeaders(origin),
    })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
