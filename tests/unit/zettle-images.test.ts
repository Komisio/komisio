import { expect, it, vi } from 'vitest'
import sharp from 'sharp'
import type { SupabaseClient } from '@supabase/supabase-js'
import { imageHttpClient, zettleImageUrl } from '../../extensions/zettle/images'
import {
  exportZettleImage,
  readZettleImages,
  readZettleImageUrl,
} from '../../lib/engine/zettle-images'
import { connectedPilotImages } from '../../extensions/zettle/auth'

const tenant = '10000000-0000-4000-8000-000000000001'
const merchant = '20000000-0000-4000-8000-000000000001'
const item = '30000000-0000-4000-8000-000000000001'
const request = '40000000-0000-4000-8000-000000000001'
const job = '50000000-0000-4000-8000-000000000001'
const url = 'https://image.izettle.com/product/synthetic.jpg'
const env = {
  ZETTLE_PILOT_TENANT_ID: tenant,
  ZETTLE_MERCHANT_ID: merchant,
  ZETTLE_CLIENT_ID: 'synthetic',
  ZETTLE_API_KEY: 'synthetic',
}
const product = {
  uuid: item,
  name: 'Jacket',
  externalReference: `komisio:${item}`,
  vatPercentage: 0,
  variants: [
    {
      uuid: job,
      sku: 'test',
      barcode: 'I-30000000',
      price: { amount: 10000, currencyId: 'SEK' },
    },
  ],
}
const jpeg = () =>
  sharp({ create: { width: 64, height: 64, channels: 3, background: 'red' } })
    .withMetadata()
    .jpeg()
    .toBuffer()

it('image credentials stay private and a changed merchant on refresh prevents uploading', async () => {
  vi.useFakeTimers()
  let tokens = 0
  let uploads = 0
  const http = vi.fn<typeof fetch>(async (input) => {
    if (String(input).endsWith('/token'))
      return Response.json({
        access_token: `synthetic-${++tokens}`,
        expires_in: 7200,
      })
    if (String(input).endsWith('/users/self'))
      return Response.json({
        organizationUuid: tokens === 1 ? merchant : tenant,
      })
    uploads++
    return Response.json({ imageLookupKey: 'synthetic', imageUrls: [url] })
  })
  try {
    const client = await connectedPilotImages(tenant, env, http)
    expect(Object.keys(client).sort()).toEqual(['putProduct', 'uploadImage'])
    vi.advanceTimersByTime(7200000)
    await expect(client.uploadImage(await jpeg())).rejects.toThrow(
      'ZETTLE_WRONG_MERCHANT',
    )
    expect(uploads).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it.each(['PGRST202', '42501', 'PGRST000'])(
  'only an uninstalled image RPC permits the old no-image export path: %s',
  async (code) => {
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: { code } })),
    } as unknown as SupabaseClient
    if (code === 'PGRST202') {
      expect(await readZettleImageUrl(client, tenant, item)).toBeNull()
      expect(await readZettleImages(client, tenant)).toBeNull()
    } else {
      await expect(readZettleImageUrl(client, tenant, item)).rejects.toThrow(
        'ZETTLE_READ_FAILED',
      )
      await expect(readZettleImages(client, tenant)).rejects.toThrow(
        'ZETTLE_READ_FAILED',
      )
    }
  },
)

it('uploads one JPEG file to the pinned merchant without exposing a Storage URL', async () => {
  const bytes = await jpeg()
  const http = vi.fn<typeof fetch>(async () =>
    Response.json({ imageLookupKey: 'synthetic', imageUrls: [url] }),
  )
  expect(
    await imageHttpClient(merchant, async () => 'synthetic-token', http)(bytes),
  ).toBe(url)
  expect(http).toHaveBeenCalledTimes(1)
  expect(http.mock.calls[0][0]).toBe(
    `https://image.izettle.com/v2/images/organizations/${merchant}/products/upload`,
  )
  const options = http.mock.calls[0][1]!
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    cache: 'no-store',
    headers: { Authorization: 'Bearer synthetic-token' },
  })
  const form = options.body as FormData
  expect([...form.keys()]).toEqual(['file'])
  const file = form.get('file') as File
  expect(file.name).toBe('product.jpg')
  expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes)
})

it.each([
  'http://image.izettle.com/product/test.jpg',
  'https://evil.example/test.jpg',
  'https://image.izettle.com.evil.example/product/test.jpg',
  'https://image.izettle.com/product/test.jpg?token=secret',
  'https://user@image.izettle.com/product/test.jpg',
])('rejects unsafe provider URL %s', (value) => {
  expect(zettleImageUrl.safeParse(value).success).toBe(false)
})
it.each([401, 403, 429, 422, 500])(
  'redacts upload failure %s without retry',
  async (status) => {
    const http = vi.fn<typeof fetch>(
      async () => new Response('private upstream body', { status }),
    )
    await expect(
      imageHttpClient(merchant, async () => 'token', http)(await jpeg()),
    ).rejects.toThrow(/^ZETTLE_(AUTH_REQUIRED|RATE_LIMITED|IMAGE_FAILED)$/)
    expect(http).toHaveBeenCalledTimes(1)
  },
)
it('does not retry a lost upload response', async () => {
  const http = vi.fn<typeof fetch>(async () => {
    throw new Error('private transport details')
  })
  await expect(
    imageHttpClient(merchant, async () => 'token', http)(await jpeg()),
  ).rejects.toThrow(/^ZETTLE_IMAGE_FAILED$/)
  expect(http).toHaveBeenCalledTimes(1)
})

async function setup(
  options: {
    role?: string
    noPhoto?: boolean
    fresh?: boolean
    uploadLost?: boolean
    saveLost?: boolean
    associationLost?: boolean
    invalidPhoto?: boolean
    changed?: boolean
    revoked?: boolean
  } = {},
) {
  let fresh = options.fresh ?? true
  let preparations = 0
  let savedUrl: string | null = null
  let associationLost = options.associationLost
  const events: string[] = []
  const rpc = vi.fn(
    async (name: string, parameters?: Record<string, unknown>) => {
      events.push(name)
      if (name === 'tenant_role')
        return { data: options.role ?? 'owner', error: null }
      if (name === 'prepare_zettle_image') {
        preparations++
        if (options.revoked && preparations > 1)
          return { data: null, error: { message: 'FORBIDDEN' } }
        const claim = {
          id: request,
          fresh,
          exportId: options.changed && preparations > 1 ? item : job,
          reference: `${tenant}/${item}/${request}.jpg`,
        }
        fresh = false
        return { data: options.noPhoto ? null : claim, error: null }
      }
      if (name === 'zettle_item_image_url')
        return { data: savedUrl, error: null }
      if (name === 'prepare_zettle_product')
        return { data: options.changed ? item : job, error: null }
      if (name === 'record_zettle_image_upload') {
        savedUrl = parameters?.p_url as string
        if (options.saveLost)
          return { data: null, error: { message: 'private SQL error' } }
      }
      return { data: null, error: null }
    },
  )
  const from = vi.fn(() => {
    const query = {
      select: () => query,
      eq: () => query,
      single: async () => ({ data: { payload: product }, error: null }),
    }
    return query
  })
  const bytes = options.invalidPhoto ? Buffer.from('bad-image') : await jpeg()
  const download = vi.fn(async () => ({
    data: new Blob([new Uint8Array(bytes)]),
    error: null,
  }))
  const uploadImage = vi.fn(async (data: Uint8Array) => {
    events.push('upload')
    const metadata = await sharp(data).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(data.length).toBeLessThanOrEqual(1024 * 1024)
    if (options.uploadLost) throw new Error('ZETTLE_IMAGE_FAILED')
    return url
  })
  const putProduct = vi.fn(async () => {
    events.push('associate')
    if (associationLost) {
      associationLost = false
      throw new Error('ZETTLE_UPDATE_FAILED')
    }
  })
  const factory = vi.fn(async () => ({ uploadImage, putProduct }))
  const client = {
    rpc,
    from,
    storage: { from: () => ({ download }) },
  } as unknown as SupabaseClient
  const run = () =>
    exportZettleImage(client, tenant, request, item, env, factory)
  return { run, rpc, factory, download, uploadImage, putProduct, events }
}

it('minimizes the exact source, persists upload before association, and never touches stock', async () => {
  const fixture = await setup()
  expect(await fixture.run()).toEqual({ id: request, image: 'synced' })
  expect(await fixture.run()).toEqual({ id: request, image: 'synced' })
  expect(fixture.download).toHaveBeenCalledWith(
    `${tenant}/${item}/${request}.jpg`,
  )
  expect(fixture.uploadImage).toHaveBeenCalledTimes(1)
  expect(fixture.putProduct).toHaveBeenCalledWith(product, product, url)
  expect(fixture.events.indexOf('prepare_zettle_image')).toBeLessThan(
    fixture.events.indexOf('upload'),
  )
  expect(fixture.events.indexOf('record_zettle_image_upload')).toBeLessThan(
    fixture.events.indexOf('associate'),
  )
  expect(fixture.events.join(' ')).not.toMatch(/stock|record_sale/)
})
it.each(['staff', 'readonly', ''])(
  'denies %s before provider or Storage access',
  async (role) => {
    const fixture = await setup({ role })
    await expect(fixture.run()).rejects.toThrow('FORBIDDEN')
    expect(fixture.factory).not.toHaveBeenCalled()
    expect(fixture.download).not.toHaveBeenCalled()
  },
)
it('missing accepted photo is explicit and causes no provider request', async () => {
  const fixture = await setup({ noPhoto: true })
  expect(await fixture.run()).toEqual({ id: request, image: 'no_photo' })
  expect(fixture.factory).not.toHaveBeenCalled()
})
it('uncertain uploads stay held on replay', async () => {
  const fixture = await setup({ uploadLost: true })
  await expect(fixture.run()).rejects.toThrow('ZETTLE_IMAGE_FAILED')
  await expect(fixture.run()).rejects.toThrow('ZETTLE_IMAGE_HELD')
  expect(fixture.uploadImage).toHaveBeenCalledTimes(1)
  expect(fixture.putProduct).not.toHaveBeenCalled()
})
it.each([{ saveLost: true }, { associationLost: true }])(
  'reuses the persisted URL after an uncertain acknowledgement %j',
  async (options) => {
    const fixture = await setup(options)
    await expect(fixture.run()).rejects.toThrow()
    expect(await fixture.run()).toEqual({ id: request, image: 'synced' })
    expect(fixture.uploadImage).toHaveBeenCalledTimes(1)
  },
)
it.each([{ invalidPhoto: true }, { changed: true }, { revoked: true }])(
  'stops before upload on invalid source or changed snapshot %j',
  async (options) => {
    const fixture = await setup(options)
    await expect(fixture.run()).rejects.toThrow()
    expect(fixture.uploadImage).not.toHaveBeenCalled()
  },
)
