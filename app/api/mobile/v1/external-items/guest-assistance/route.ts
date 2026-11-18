import {
  guestPhotoCommand,
  runGuestPhotoAnalysis,
} from '@/lib/engine/guest-photo-assistance'
import { boundedJson } from '@/lib/http/bounded-json'
import {
  guestPhotoClient,
  guestPhotoNetworkHash,
} from '@/lib/platform/guest-photo-client'
import { MobileRequestError, mobileOrigin } from '@/lib/platform/mobile-seller'
import {
  externalItemsEnabled,
  externalItemFailure,
  externalItemHeaders,
  externalItemOptions,
} from '@/lib/platform/mobile-external-items'

export const maxDuration = 60
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
    if (
      request.headers.get('content-type')?.split(';')[0].trim() !==
      'application/json'
    )
      throw new MobileRequestError('INVALID_INPUT', 415)
    // Eight 256 KiB JPEGs fit below the hosted request limit after Base64.
    const c = guestPhotoCommand.safeParse(await boundedJson(request, 2900000))
    if (!c.success) throw new MobileRequestError('INVALID_INPUT', 400)
    return Response.json(
      await runGuestPhotoAnalysis(
        guestPhotoClient(),
        c.data,
        guestPhotoNetworkHash(request),
        AbortSignal.timeout(40000),
      ),
      { headers: externalItemHeaders(origin) },
    )
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
