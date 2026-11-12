import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  assurance: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
import { POST, OPTIONS } from '../../app/api/mobile/v1/external-items/route'
import { POST as photoPost } from '../../app/api/mobile/v1/external-items/photos/route'
import { POST as sellerPost } from '../../app/api/mobile/v1/seller/route'
import { POST as offerPost } from '../../app/api/mobile/v1/external-items/offers/route'
import { POST as onboardingPost } from '../../app/api/mobile/v1/external-items/onboarding/route'
import { POST as shippingPost } from '../../app/api/mobile/v1/external-items/shipping/route'
import { issueExternalOfferCommand } from '../../lib/engine/external-item-offers'
import { externalItemSubmission } from '../../lib/engine/external-item-requests'

const owner = 'f6100000-0000-4000-8000-000000000002'
const photoId = 'f6100000-0000-4000-8000-000000000101'
const requestId = 'f6100000-0000-4000-8000-000000000201'
const tenantId = 'f6100000-0000-4000-8000-000000000301'
const input = {
  action: 'submit',
  requestId,
  tenantId,
  description: ' Jacket ',
  brand: 'Synthetic',
  condition: 'good',
  notes: '',
  desiredPriceOre: '10000',
  currency: 'SEK',
  senderCountry: 'SE',
  photos: [photoId],
}
const identity = {
  id: owner,
  phone: '46700006102',
  phone_confirmed_at: '2026-11-10',
  app_metadata: {},
}
it('shipping reads require bearer phone identity and never trust caller capability headers', async () => {
  mocks.rpc.mockResolvedValue({
    data: { offerId: requestId, configured: false, parcel: null },
    error: null,
  })
  const response = await shippingPost(
    request(
      { action: 'read', offerId: requestId },
      { 'x-komisio-shipping': 'attacker' },
    ),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    offerId: requestId,
    parcel: null,
    available: false,
  })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(mocks.createClient.mock.calls[0][2].global.headers).toEqual({
    Authorization: 'Bearer synthetic.access.token',
  })
  mocks.getUser.mockResolvedValue({
    data: { user: { ...identity, phone_confirmed_at: null } },
    error: null,
  })
  expect(
    (await shippingPost(request({ action: 'read', offerId: requestId })))
      .status,
  ).toBe(403)
})
it('persists seller compensation meaning explicitly while keeping legacy requests distinguishable', async () => {
  mocks.rpc.mockResolvedValue({ data: requestId, error: null })
  expect(
    (await POST(request({ ...input, priceBasis: 'seller_amount' }))).status,
  ).toBe(200)
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    'submit_external_item_request',
    expect.objectContaining({
      p_price_basis: 'seller_amount',
      p_price_ore: '10000',
    }),
  )
  mocks.rpc.mockClear()
  expect((await POST(request())).status).toBe(200)
  expect(mocks.rpc.mock.calls[0][1]).not.toHaveProperty('p_price_basis')
})
function request(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request('https://api.example.test/api/mobile/v1/external-items', {
    method: 'POST',
    headers: {
      authorization: 'Bearer synthetic.access.token',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}
function photoRequest(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request(
    `https://api.example.test/api/mobile/v1/external-items/photos?photoId=${photoId}`,
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic.access.token',
        'content-type': 'image/png',
        ...headers,
      },
      body: new Uint8Array(body),
    },
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('KOMISIO_MOBILE_API_ENABLED', 'true')
  vi.stubEnv('KOMISIO_MOBILE_ALLOWED_ORIGINS', 'https://mobile.example.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'synthetic-public-key')
  mocks.createClient.mockReturnValue({
    auth: {
      getUser: mocks.getUser,
      mfa: { getAuthenticatorAssuranceLevel: mocks.assurance },
    },
    rpc: mocks.rpc,
    storage: { from: mocks.from },
  })
  mocks.getUser.mockResolvedValue({ data: { user: identity }, error: null })
  mocks.assurance.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    error: null,
  })
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'reserve_external_item_photo' ||
      name === 'discard_external_item_photo'
        ? `${owner}/${photoId}.jpg`
        : requestId,
    error: null,
  }))
  mocks.from.mockReturnValue({
    upload: mocks.upload,
    download: mocks.download,
    remove: mocks.remove,
  })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('central offer boundary', () => {
  const agreementId = 'f6100000-0000-4000-8000-000000000401'
  const offerId = 'f6100000-0000-4000-8000-000000000501'
  it('keeps the exact response ID and displayed agreement, without accepting an owner override', async () => {
    const c = {
      action: 'respond',
      requestId,
      offerId,
      accepted: true,
      agreementVersionId: agreementId,
    }
    expect((await offerPost(request({ ...c, ownerId: owner }))).status).toBe(
      400,
    )
    expect(mocks.rpc).not.toHaveBeenCalled()
    const response = await offerPost(request(c))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: requestId })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'respond_external_item_offer',
      {
        p_id: requestId,
        p_offer: offerId,
        p_accepted: true,
        p_agreement: agreementId,
      },
    )
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('returns expiry as a conflict without treating it as accepted', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'OFFER_EXPIRED' },
    })
    const response = await offerPost(
      request({
        action: 'respond',
        requestId,
        offerId,
        accepted: true,
        agreementVersionId: agreementId,
      }),
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'OFFER_EXPIRED' })
  })
  it('retains phone verification and MFA on offer reads and answers', async () => {
    mocks.assurance.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })
    expect((await offerPost(request({ action: 'read', offerId }))).status).toBe(
      403,
    )
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('bounds list scope and refuses unrequested offer summaries', async () => {
    expect(
      (
        await offerPost(
          request({ action: 'list', requestIds: Array(26).fill(requestId) }),
        )
      ).status,
    ).toBe(400)
    mocks.rpc.mockResolvedValue({
      data: {
        offers: [
          {
            id: offerId,
            requestId: photoId,
            tenantId,
            sellerAmountOre: '40000',
            expectedSalePriceOre: '100000',
            currency: 'SEK',
            agreementVersionId: agreementId,
            createdAt: '2026-11-10T12:00:00Z',
            expiresAt: '2026-11-12T12:00:00Z',
            serverNow: '2026-11-10T12:00:00Z',
            status: 'offered',
            canAccept: true,
            canDecline: true,
            response: null,
          },
        ],
        serverNow: '2026-11-10T12:00:00Z',
      },
      error: null,
    })
    expect(
      (await offerPost(request({ action: 'list', requestIds: [requestId] })))
        .status,
    ).toBe(503)
  })
  it('accepts only exact positive integer ore for staff offers', () => {
    const c = {
      action: 'offer',
      tenantId,
      commandId: offerId,
      requestId,
      previousOfferId: null,
      sellerAmountOre: '40000',
      expectedSalePriceOre: '100000',
      agreementVersionId: agreementId,
    }
    expect(issueExternalOfferCommand.safeParse(c).success).toBe(true)
    for (const sellerAmountOre of ['1.5', '1e5', '0', '-1', '100000000000'])
      expect(
        issueExternalOfferCommand.safeParse({ ...c, sellerAmountOre }).success,
      ).toBe(false)
  })
})

describe('external request phone boundary', () => {
  it('canonicalizes UUID casing before replay comparisons and duplicate detection', async () => {
    expect(
      (
        await POST(
          request({
            ...input,
            requestId: requestId.toUpperCase(),
            photos: [photoId.toUpperCase()],
          }),
        )
      ).status,
    ).toBe(200)
    expect(mocks.rpc.mock.calls[0][1].p_id).toBe(requestId)
    expect(
      externalItemSubmission.safeParse({
        ...input,
        photos: [photoId, photoId.toUpperCase()],
      }).success,
    ).toBe(false)
  })
  it('accepts a real verified phone without email or membership, retaining the frozen request ID and exact ore', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: requestId })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'submit_external_item_request',
      {
        p_id: requestId,
        p_tenant: tenantId,
        p_description: 'Jacket',
        p_brand: 'Synthetic',
        p_condition: 'good',
        p_notes: '',
        p_price_ore: '10000',
        p_currency: 'SEK',
        p_sender_country: 'SE',
        p_photos: [photoId],
      },
    )
    expect(mocks.createClient.mock.calls[0][2].auth.persistSession).toBe(false)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('keeps phone-only identities out of existing payout commands', async () => {
    const response = await sellerPost(
      request({
        action: 'requestPayout',
        tenantId,
        sellerId: owner,
        requestId,
        amountOre: 10000,
      }),
    )
    expect(response.status).toBe(401)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([
    { ...identity, phone_confirmed_at: null },
    { ...identity, phone: '' },
    {
      ...identity,
      phone_confirmed_at: null,
      email_confirmed_at: '2026-11-10',
      user_metadata: { phone_confirmed_at: '2026-11-10' },
    },
  ])('rejects missing or user-editable phone verification', async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requires MFA for enrolled phone accounts', async () => {
    mocks.assurance.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })
    const response = await POST(request())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'MFA_REQUIRED' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('fails closed when assurance cannot be verified', async () => {
    mocks.assurance.mockResolvedValue({
      data: null,
      error: new Error('provider unavailable'),
    })
    expect((await POST(request())).status).toBe(503)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('preserves protected password recovery restrictions', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          ...identity,
          app_metadata: { komisio_password_recovery_pending: true },
        },
      },
      error: null,
    })
    expect((await POST(request())).status).toBe(409)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('never obtains identity from cookies', async () => {
    expect(
      (
        await POST(
          request(input, { authorization: '', cookie: 'staff=secret' }),
        )
      ).status,
    ).toBe(401)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
  it.each([
    'ACTIVE_REQUEST_LIMIT',
    'STORE_UNAVAILABLE',
    'STORE_CHANGED',
    'REQUEST_CONFLICT',
    'PHOTO_NOT_FOUND',
  ])('returns actionable %s without retrying the command', async (code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: code } })
    const response = await POST(request())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: code })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('does not report an unrelated RPC result as submission success', async () => {
    mocks.rpc.mockResolvedValue({ data: photoId, error: null })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' })
  })
  it('does not expose unknown database errors', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private connection details' },
    })
    expect(await (await POST(request())).json()).toEqual({
      error: 'REQUEST_FAILED',
    })
  })
  it.each([
    { ...input, photos: [] },
    { ...input, photos: [photoId, photoId] },
    { ...input, desiredPriceOre: '1.5' },
    { ...input, desiredPriceOre: 100 },
    { ...input, ownerId: owner },
  ])(
    'rejects invalid or actor-supplied payloads before a command',
    async (invalid) => {
      expect((await POST(request(invalid))).status).toBe(400)
      expect(mocks.rpc).not.toHaveBeenCalled()
    },
  )
  it('preserves a missing price wish without assigning a value', () => {
    expect(
      externalItemSubmission.parse({ ...input, desiredPriceOre: null })
        .desiredPriceOre,
    ).toBeNull()
  })
  it('bounds JSON before identity work', async () => {
    expect(
      (await POST(request({ ...input, notes: 'x'.repeat(9000) }))).status,
    ).toBe(413)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
  it('rejects browser origins outside the existing allowlist', async () => {
    expect(
      (await POST(request(input, { origin: 'https://evil.example.test' })))
        .status,
    ).toBe(403)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
  it('supports the existing explicit browser preflight contract', async () => {
    const response = await OPTIONS(
      new Request('https://api.example.test', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://mobile.example.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'https://mobile.example.test',
    )
  })
  it('uses the existing runtime activation switches', async () => {
    vi.stubEnv('KOMISIO_MOBILE_API_ENABLED', 'false')
    expect((await POST(request())).status).toBe(404)
    expect(mocks.getUser).not.toHaveBeenCalled()
  })
  it('reconciles a single uncertain request by its original ID', async () => {
    mocks.rpc.mockResolvedValue({
      data: { activeCount: 0, hasMore: false, requests: [] },
      error: null,
    })
    expect((await POST(request({ action: 'list', requestId }))).status).toBe(
      200,
    )
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'my_external_item_requests',
      { p_offset: 0, p_id: requestId },
    )
  })
})

describe('private external photos', () => {
  it('confirms an already completed discard without another Storage deletion', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    expect(
      (await POST(request({ action: 'discardPhoto', photoId }))).status,
    ).toBe(200)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('sanitizes metadata and bounds dimensions before reservation/upload', async () => {
    const bytes = await sharp({
      create: { width: 1800, height: 900, channels: 3, background: '#ffffff' },
    })
      .withMetadata({ exif: { IFD0: { Artist: 'Private metadata' } } })
      .png()
      .toBuffer()
    expect((await photoPost(photoRequest(bytes))).status).toBe(200)
    const [path, normalized, options] = mocks.upload.mock.calls[0]
    expect(path).toBe(`${owner}/${photoId}.jpg`)
    expect(options.upsert).toBe(false)
    const metadata = await sharp(normalized).metadata()
    expect(metadata.width).toBe(1536)
    expect(metadata.format).toBe('jpeg')
    expect(metadata.exif).toBeUndefined()
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_id: photoId,
      p_bytes: normalized.length,
    })
    expect(mocks.rpc.mock.calls[0][1].p_sha256).toMatch(/^[a-f0-9]{64}$/)
  })
  it('rejects corrupt images before reserving storage', async () => {
    const response = await photoPost(photoRequest(new Uint8Array(40)))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('bounds the actual bytes even if Content-Length lies', async () => {
    expect(
      (
        await photoPost(
          photoRequest(new Uint8Array(3 * 1024 * 1024 + 1), {
            'content-length': '100',
          }),
        )
      ).status,
    ).toBe(413)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('accepts an interrupted upload only when stored sanitized bytes match', async () => {
    const bytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer()
    mocks.upload.mockImplementation(async (_path, normalized) => {
      mocks.download.mockResolvedValue({
        data: new Blob([new Uint8Array(normalized)]),
        error: null,
      })
      return { error: { message: 'already uploaded' } }
    })
    expect((await photoPost(photoRequest(bytes))).status).toBe(200)
    expect(mocks.upload).toHaveBeenCalledTimes(1)
  })
  it('does not replace different bytes after an upload error', async () => {
    const bytes = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer()
    mocks.upload.mockResolvedValue({ error: { message: 'already exists' } })
    mocks.download.mockResolvedValue({
      data: new Blob(['different']),
      error: null,
    })
    expect((await photoPost(photoRequest(bytes))).status).toBe(503)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('never deletes a submitted photo if the discard claim is denied', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'PHOTO_IN_USE' },
    })
    expect(
      (await POST(request({ action: 'discardPhoto', photoId }))).status,
    ).toBe(409)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('does not release the reservation after an uncertain Storage deletion', async () => {
    mocks.remove.mockResolvedValue({ error: { message: 'network error' } })
    expect(
      (await POST(request({ action: 'discardPhoto', photoId }))).status,
    ).toBe(503)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
})

describe('central account and handover boundary', () => {
  const agreementId = 'f6100000-0000-4000-8000-000000000401',
    offerId = 'f6100000-0000-4000-8000-000000000501'
  const command = {
    action: 'complete',
    requestId,
    offerId,
    agreementVersionId: agreementId,
    profile: { name: 'Synthetic phone owner', email: 'contact@example.test' },
    bank: {
      holder: 'Synthetic phone owner',
      country: 'SE',
      kind: 'local',
      routing: '8327',
      account: '123456789',
    },
  }
  it('owns identity on the server and passes exact consent and bank data through the engine', async () => {
    for (const patch of [
      { ownerId: owner },
      { sellerId: owner },
      { bank: { ...command.bank, country: 'DE' } },
      { bank: { ...command.bank, routing: '' } },
    ])
      expect(
        (await onboardingPost(request({ ...command, ...patch }))).status,
      ).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
    const r = await onboardingPost(request(command))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ id: requestId })
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      'complete_external_item_offer',
      {
        p_id: requestId,
        p_offer: offerId,
        p_agreement: agreementId,
        p_profile: command.profile,
        p_bank: command.bank,
      },
    )
    expect(r.headers.get('cache-control')).toBe('private, no-store')
  })
  it('requires verified phone and current MFA before reading account data', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { ...identity, phone_confirmed_at: null } },
      error: null,
    })
    expect(
      (await onboardingPost(request({ action: 'read', offerId }))).status,
    ).toBe(403)
    mocks.getUser.mockResolvedValue({ data: { user: identity }, error: null })
    mocks.assurance.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    })
    expect((await onboardingPost(request(command))).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('only renders an owned open handover QR and never includes bank details', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test')
    const data = {
      offerId,
      tenantId,
      phone: identity.phone,
      store: { address: null, openingHours: [] },
      account: {
        id: owner,
        name: 'Synthetic',
        email: 'contact@example.test',
        hasBank: true,
      },
      handover: {
        id: requestId,
        reference: 'H-128',
        status: 'open',
        receivedAt: null,
        itemCount: 1,
        items: [
          { requestId, offerId, description: 'Jacket', brand: '', photoId },
        ],
      },
    }
    mocks.rpc.mockResolvedValue({ data, error: null })
    const r = await onboardingPost(request({ action: 'read', offerId }))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.qrPng).toMatch(/^data:image\/png;base64,/)
    expect(body.bank).toBeUndefined()
    expect(
      (await sharp(Buffer.from(body.qrPng.split(',')[1], 'base64')).metadata())
        .format,
    ).toBe('png')
    mocks.rpc.mockResolvedValue({
      data: {
        ...data,
        handover: {
          ...data.handover,
          status: 'received',
          receivedAt: '2026-11-10T12:00:00Z',
        },
      },
      error: null,
    })
    expect(
      (
        await (
          await onboardingPost(request({ action: 'read', offerId }))
        ).json()
      ).qrPng,
    ).toBeNull()
    mocks.rpc.mockResolvedValue({
      data: { ...data, offerId: owner },
      error: null,
    })
    expect(
      (await onboardingPost(request({ action: 'read', offerId }))).status,
    ).toBe(503)
  })
})

it('returns authorized handover progress through the existing bounded offer read', async () => {
  const offerId = 'f6100000-0000-4000-8000-000000000501',
    agreementId = 'f6100000-0000-4000-8000-000000000401'
  const handover = {
    id: requestId,
    reference: 'H-128',
    status: 'received',
    receivedAt: '2026-11-10T12:00:00Z',
    itemCount: 2,
  }
  const data = {
    id: offerId,
    requestId,
    tenantId,
    sellerAmountOre: '40000',
    expectedSalePriceOre: '100000',
    currency: 'SEK',
    agreementVersionId: agreementId,
    createdAt: '2026-11-10T10:00:00Z',
    expiresAt: '2026-11-12T10:00:00Z',
    serverNow: '2026-11-10T12:00:00Z',
    status: 'accepted',
    canAccept: false,
    canDecline: false,
    response: {
      id: photoId,
      accepted: true,
      createdAt: '2026-11-10T11:00:00Z',
    },
    agreement: {
      id: agreementId,
      version: 1,
      title: 'Synthetic terms',
      body: 'Synthetic text',
      language: 'sv',
    },
    handover,
  }
  mocks.rpc.mockResolvedValue({ data, error: null })
  const r = await offerPost(request({ action: 'read', offerId }))
  expect(r.status).toBe(200)
  expect((await r.json()).handover).toEqual(handover)
  mocks.rpc.mockResolvedValue({
    data: { ...data, handover: { ...handover, receivedAt: null } },
    error: null,
  })
  expect((await offerPost(request({ action: 'read', offerId }))).status).toBe(
    503,
  )
  const guarantee = {
    id: requestId,
    amountOre: '40000',
    currency: 'SEK',
    receivedAt: '2026-11-10T12:00:00Z',
    dueAt: '2026-12-25T12:00:00Z',
    creditedAt: null,
  }
  mocks.rpc.mockResolvedValue({ data: { ...data, guarantee }, error: null })
  const guaranteed = await offerPost(request({ action: 'read', offerId }))
  expect(guaranteed.status).toBe(200)
  expect((await guaranteed.json()).guarantee).toEqual(guarantee)
  mocks.rpc.mockResolvedValue({
    data: {
      ...data,
      guarantee: { ...guarantee, dueAt: '2026-11-11T12:00:00Z' },
    },
    error: null,
  })
  expect((await offerPost(request({ action: 'read', offerId }))).status).toBe(
    503,
  )
})
