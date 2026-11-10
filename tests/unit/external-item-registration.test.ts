import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  rpc: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
}))
vi.mock('@/lib/platform/context', () => ({ platformContext: mocks.context }))
vi.mock('@/lib/engine/reception-photos', () => ({
  uploadReceptionPhoto: mocks.upload,
  photoLimit: 3000000,
}))
import { POST } from '../../app/api/intake/requests/register/route'
const id = (n: number) =>
  `f7400000-0000-4000-8000-${String(n).padStart(12, '0')}`
const input = {
  tenantId: id(1),
  commandId: id(2),
  guaranteeId: id(3),
  description: 'Jacket',
  priceOre: '30000',
}
const request = (
  body: unknown = input,
  origin = 'https://portal.example.test',
) =>
  new Request(`${origin}/api/intake/requests/register`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
const state = {
  sessionId: id(4),
  ownerId: id(5),
  photoIds: [id(6)],
  itemId: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.example.test')
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('KOMISIO_MOBILE_API_ENABLED', 'true')
  mocks.context.mockResolvedValue({
    active: { id: id(1) },
    mfaRequired: false,
    client: {
      rpc: mocks.rpc,
      storage: {
        from: (bucket: string) => {
          expect(bucket).toBe('external-item-photos')
          return { download: mocks.download }
        },
      },
    },
  })
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name.startsWith('prepare_') ? state : id(7),
    error: null,
  }))
  mocks.download.mockResolvedValue({
    data: new Blob([new Uint8Array([1, 2, 3])]),
    error: null,
  })
})
it('requires the selected tenant, same origin, authentication and MFA before any preparation', async () => {
  expect(
    (await POST(request(input, 'https://foreign.example.test'))).status,
  ).toBe(403)
  expect((await POST(request({ ...input, tenantId: id(9) }))).status).toBe(409)
  mocks.context.mockResolvedValue({ mfaRequired: true })
  expect((await POST(request())).status).toBe(401)
  mocks.context.mockResolvedValue(null)
  expect((await POST(request())).status).toBe(401)
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('copies only server-owned photos and passes exact öre to the atomic registration', async () => {
  const result = await POST(request())
  expect(result.status).toBe(200)
  expect(result.headers.get('cache-control')).toBe('private, no-store')
  expect(await result.json()).toEqual({ id: id(2), itemId: id(7) })
  expect(mocks.download).toHaveBeenCalledExactlyOnceWith(
    `${id(5)}/${id(6)}.jpg`,
  )
  expect(mocks.upload).toHaveBeenCalledWith(
    expect.anything(),
    { tenantId: id(1), sessionId: id(4), photoId: id(6) },
    new Uint8Array([1, 2, 3]),
  )
  expect(mocks.rpc).toHaveBeenLastCalledWith('register_external_item', {
    p_tenant: id(1),
    p_id: id(2),
    p_guarantee: id(3),
    p_description: 'Jacket',
    p_price_ore: '30000',
  })
})
it('does not register with missing photo evidence or accept caller-provided ownership/terms', async () => {
  for (const extra of [
    { ownerId: id(8) },
    { agreementId: id(8) },
    { priceOre: '1.5' },
    { priceOre: '100000000' },
  ])
    expect((await POST(request({ ...input, ...extra }))).status).toBe(400)
  expect(mocks.rpc).not.toHaveBeenCalled()
  mocks.download.mockResolvedValue({
    data: null,
    error: { message: 'missing' },
  })
  expect((await POST(request())).status).toBe(409)
  expect(mocks.upload).not.toHaveBeenCalled()
  expect(mocks.rpc).toHaveBeenCalledTimes(1)
})
it('checks the exact command again after a lost response without copying photos again', async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name.startsWith('prepare_') ? { ...state, itemId: id(7) } : id(7),
    error: null,
  }))
  expect((await POST(request())).status).toBe(200)
  expect(mocks.download).not.toHaveBeenCalled()
  expect(mocks.rpc).toHaveBeenCalledTimes(2)
  mocks.rpc.mockImplementation(async (name: string) =>
    name.startsWith('prepare_')
      ? { data: { ...state, itemId: id(7) }, error: null }
      : { data: null, error: { message: 'REQUEST_CONFLICT' } },
  )
  expect(
    (await POST(request({ ...input, description: 'Changed' }))).status,
  ).toBe(409)
})
it('rejects malformed preparation and unconfirmed registration evidence without exposing backend details', async () => {
  mocks.rpc.mockResolvedValue({
    data: { ...state, ownerId: 'unknown' },
    error: null,
  })
  expect((await POST(request())).status).toBe(503)
  expect(mocks.download).not.toHaveBeenCalled()
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name.startsWith('prepare_') ? { ...state, itemId: id(7) } : id(8),
    error: null,
  }))
  const response = await POST(request())
  expect(await response.json()).toEqual({ error: 'REQUEST_FAILED' })
})
