import { z } from 'zod'
import { uploadExternalItemPhoto } from '@/lib/engine/external-item-requests'
import {
  MobileRequestError,
  mobileOrigin,
  mobilePhoneClient,
} from '@/lib/platform/mobile-seller'
import {
  externalItemsEnabled,
  externalItemHeaders,
  externalItemFailure,
  externalItemOptions,
  externalPhotoBytes,
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
    const id = z
      .uuid()
      .safeParse(new URL(request.url).searchParams.get('photoId'))
    if (!id.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobilePhoneClient(request)
    return Response.json(
      await uploadExternalItemPhoto(
        client,
        id.data,
        await externalPhotoBytes(request),
      ),
      { headers: externalItemHeaders(origin) },
    )
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
