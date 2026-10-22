import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST } from '../../app/api/print/weblink/route'
import { platformContext } from '../../lib/platform/context'
vi.mock('../../lib/platform/context', () => ({ platformContext: vi.fn() }))
const id = 'f0000000-0000-4000-8000-000000005431'
const other = 'f0000000-0000-4000-8000-000000005432'
const rpc = vi.fn()
const registration = {
  action: 'register',
  tenantId: id,
  id: other,
  name: 'Zebra',
  model: 'ZD420',
  dpi: 203,
}
const resolution = {
  action: 'resolve',
  tenantId: id,
  id: other,
  resolution: 'printed',
  note: 'Inspected all labels and stopped connection',
  inspected: true,
}
function context(role = 'owner', mfaRequired = false, tenant = id) {
  vi.mocked(platformContext).mockResolvedValue({
    client: { rpc },
    mfaRequired,
    active: { id: tenant, role },
  } as unknown as NonNullable<Awaited<ReturnType<typeof platformContext>>>)
}
function request(
  body: unknown = registration,
  origin = 'https://app.example.test',
) {
  return new Request('https://app.example.test/api/print/weblink', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('KOMISIO_WEBLINK_SETUP_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test')
  context()
  rpc.mockResolvedValue({ data: other, error: null })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})
it('registers with no activation or transport arguments and exact confirmation', async () => {
  const r = await POST(request())
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ ok: true, id: other })
  expect(r.headers.get('cache-control')).toContain('no-store')
  expect(rpc).toHaveBeenCalledWith('register_weblink_printer', {
    p_tenant: id,
    p_id: other,
    p_name: 'Zebra',
    p_model: 'ZD420',
    p_dpi: 203,
  })
})
it.each(['false', '', 'TRUE'])(
  'blocks setup with flag %s but retains recovery',
  async (flag) => {
    vi.stubEnv('KOMISIO_WEBLINK_SETUP_ENABLED', flag)
    expect((await POST(request())).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect((await POST(request(resolution))).status).toBe(200)
  },
)
it.each(['staff', 'readonly', 'seller', 'device'])(
  'refuses role %s',
  async (role) => {
    context(role)
    expect((await POST(request())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  },
)
it('requires MFA, same origin and active tenant', async () => {
  context('owner', true)
  expect((await POST(request())).status).toBe(401)
  context()
  expect(
    (await POST(request(registration, 'https://evil.example.test'))).status,
  ).toBe(403)
  context('owner', false, other)
  expect((await POST(request())).status).toBe(409)
  expect(rpc).not.toHaveBeenCalled()
})
it.each([
  { ...registration, active: true },
  { ...registration, transport: 'tcp' },
  { ...resolution, inspected: false },
  { ...resolution, note: ' ' },
  { ...resolution, resolution: 'queued' },
])('rejects unsupported command %j', async (value) => {
  expect((await POST(request(value))).status).toBe(400)
  expect(rpc).not.toHaveBeenCalled()
})
it.each([null, true, id, { ok: true, id: other }])(
  'holds malformed database confirmation %j',
  async (data) => {
    rpc.mockResolvedValue({ data, error: null })
    expect((await POST(request())).status).toBe(503)
  },
)
it('does not leak unknown database errors and retains the revocation guard', async () => {
  rpc.mockResolvedValue({ error: { message: 'secret database detail' } })
  let r = await POST(request())
  expect(r.status).toBe(503)
  expect(await r.json()).toEqual({ error: 'REQUEST_FAILED' })
  rpc.mockResolvedValue({ error: { message: 'PRINT_DEVICE_STILL_ACTIVE' } })
  r = await POST(request(resolution))
  expect(r.status).toBe(400)
  expect(await r.json()).toEqual({ error: 'PRINT_DEVICE_STILL_ACTIVE' })
})
it('requires a true revocation confirmation', async () => {
  rpc.mockResolvedValue({ data: false })
  expect(
    (await POST(request({ action: 'revoke', tenantId: id, id: other }))).status,
  ).toBe(503)
  rpc.mockResolvedValue({ data: true })
  expect(
    (await POST(request({ action: 'revoke', tenantId: id, id: other }))).status,
  ).toBe(200)
  expect(rpc).toHaveBeenLastCalledWith('revoke_print_device', {
    p_tenant: id,
    p_device: other,
  })
})
const pilot = {
  action: 'enablePilot',
  tenantId: id,
  id: other,
  deviceId: id,
  acknowledged: true,
}
it('pins the selected device and requires a deliberate pilot acknowledgement', async () => {
  expect((await POST(request({ ...pilot, acknowledged: false }))).status).toBe(
    400,
  )
  expect((await POST(request({ ...pilot, deviceId: undefined }))).status).toBe(
    400,
  )
  expect(rpc).not.toHaveBeenCalled()
  expect((await POST(request(pilot))).status).toBe(200)
  expect(rpc).toHaveBeenCalledWith('set_weblink_pilot', {
    p_tenant: id,
    p_printer: other,
    p_active: true,
    p_device: id,
    p_acknowledged: true,
  })
})
it('disabling setup blocks pilot enablement but always permits pausing', async () => {
  vi.stubEnv('KOMISIO_WEBLINK_SETUP_ENABLED', 'false')
  expect((await POST(request(pilot))).status).toBe(404)
  expect(rpc).not.toHaveBeenCalled()
  expect(
    (await POST(request({ action: 'pausePilot', tenantId: id, id: other })))
      .status,
  ).toBe(200)
  expect(rpc).toHaveBeenCalledWith('set_weblink_pilot', {
    p_tenant: id,
    p_printer: other,
    p_active: false,
    p_device: null,
    p_acknowledged: false,
  })
})
