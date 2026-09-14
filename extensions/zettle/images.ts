import { z } from 'zod'
import { boundedJson } from '../../lib/http/bounded-json'
import { photoType } from '../../lib/media/reception-photo'

export const zettleImageUrl = z
  .string()
  .max(512)
  .regex(
    /^https:\/\/image\.izettle\.com\/(product|v2\/images\/product)\/[A-Za-z0-9_-]+(?:\.(?:jpg|jpeg|png))?$/,
  )

export function imageHttpClient(
  merchant: string,
  token: () => Promise<string>,
  http: typeof fetch = globalThis.fetch,
) {
  z.uuid().parse(merchant)
  return async (bytes: Uint8Array): Promise<string> => {
    try {
      if (bytes.length > 1024 * 1024 || photoType(bytes).mime !== 'image/jpeg')
        throw new Error('ZETTLE_IMAGE_INVALID')
      const access = await token()
      if (!access || /[\r\n]/.test(access))
        throw new Error('ZETTLE_AUTH_REQUIRED')
      const form = new FormData()
      form.set(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
        'product.jpg',
      )
      const response = await http(
        `https://image.izettle.com/v2/images/organizations/${merchant}/products/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access}`,
            Accept: 'application/json',
          },
          body: form,
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        },
      )
      if ([401, 403].includes(response.status))
        throw new Error('ZETTLE_AUTH_REQUIRED')
      if (response.status === 429) throw new Error('ZETTLE_RATE_LIMITED')
      if (response.status !== 200) throw new Error('ZETTLE_IMAGE_FAILED')
      const result = z
        .object({
          imageLookupKey: z.string().min(1).max(256),
          imageUrls: z.array(zettleImageUrl).min(1).max(8),
        })
        .parse(await boundedJson(response, 8192))
      return result.imageUrls[0]
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      throw new Error(
        [
          'ZETTLE_AUTH_REQUIRED',
          'ZETTLE_RATE_LIMITED',
          'ZETTLE_WRONG_MERCHANT',
          'ZETTLE_IMAGE_INVALID',
        ].includes(code)
          ? code
          : 'ZETTLE_IMAGE_FAILED',
      )
    }
  }
}

export function productImageFields(raw: unknown, expected: string) {
  zettleImageUrl.parse(expected)
  const parsed = z
    .object({
      presentation: z
        .object({
          imageUrl: z.string().max(512).nullable().optional(),
          backgroundColor: z.string().max(64).nullable().optional(),
          textColor: z.string().max(64).nullable().optional(),
        })
        .strict()
        .nullable()
        .optional(),
      imageLookupKeys: z
        .array(z.string().max(256))
        .max(1)
        .nullable()
        .optional(),
    })
    .safeParse(raw)
  if (!parsed.success) throw new Error('ZETTLE_REMOTE_CHANGED')
  const { presentation, imageLookupKeys } = parsed.data
  const actual = presentation?.imageUrl
  if ((actual && actual !== expected) || (!actual && imageLookupKeys?.length))
    throw new Error('ZETTLE_REMOTE_CHANGED')
  return {
    matches: actual === expected,
    fields: {
      presentation: { ...presentation, imageUrl: expected },
      ...(imageLookupKeys == null ? {} : { imageLookupKeys }),
    },
  }
}
