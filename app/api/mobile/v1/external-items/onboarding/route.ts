import sharp from 'sharp'
import {
  executeExternalOnboarding,
  externalOnboardingCommand,
} from '@/lib/engine/external-item-onboarding'
import { handoverQr } from '@/lib/labels/handover-qr'
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
    const input = externalOnboardingCommand.safeParse(await mobileJson(request))
    if (!input.success) throw new MobileRequestError('INVALID_INPUT', 400)
    const client = await mobilePhoneClient(request)
    const result = await executeExternalOnboarding(client, input.data)
    let qrPng: string | null = null
    if ('handover' in result && result.handover?.status === 'open') {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL
      if (!appUrl) throw new Error('REQUEST_FAILED')
      const png = await sharp(
        Buffer.from(handoverQr(result.handover.reference, appUrl)),
      )
        .png()
        .toBuffer()
      qrPng = `data:image/png;base64,${png.toString('base64')}`
    }
    return Response.json('handover' in result ? { ...result, qrPng } : result, {
      headers: externalItemHeaders(origin),
    })
  } catch (error) {
    return externalItemFailure(error, origin)
  }
}
