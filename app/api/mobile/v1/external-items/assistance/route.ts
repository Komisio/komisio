import {
  externalPhotoAnalysisCommand,
  runExternalPhotoAnalysis,
} from '@/lib/engine/external-photo-assistance'
import {
  MobileRequestError,
  mobileJson,
  mobileOrigin,
  mobilePhoneClient,
  mobilePhotoAiClient,
} from '@/lib/platform/mobile-seller'
import {
  externalItemsEnabled,
  externalItemHeaders,
  externalItemFailure,
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
    const command = externalPhotoAnalysisCommand.safeParse(
      await mobileJson(request),
    )
    if (!command.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await (command.data.action === 'read'
      ? mobilePhoneClient(request)
      : mobilePhotoAiClient(request))
    // Finish and persist an already-started attempt even if the phone disconnects.
    const result = await runExternalPhotoAnalysis(
      client,
      command.data,
      AbortSignal.timeout(40000),
    )
    return Response.json(result, { headers: externalItemHeaders(origin) })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
