import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  manageHostedWeblink,
  managedWeblinkConfigured,
} from '../../lib/engine/managed-weblink'
import { readPrinters } from '../../lib/engine/printing'
import {
  readPrintDevices,
  createPairingCode,
} from '../../lib/engine/print-devices'
import { platformContext } from '../../lib/platform/context'
import { POST } from '../../app/api/print/weblink/managed/route'
vi.mock('../../lib/engine/printing', () => ({ readPrinters: vi.fn() }))
vi.mock('../../lib/engine/print-devices', () => ({
  readPrintDevices: vi.fn(),
  createPairingCode: vi.fn(),
}))
vi.mock('../../lib/platform/context', () => ({ platformContext: vi.fn() }))
const tenantId = '10000000-0000-4000-8000-000000000001'
const printerId = '20000000-0000-4000-8000-000000000002'
const deviceId = '30000000-0000-4000-8000-000000000003'
const command = { tenantId, printerId, action: 'connect' as const }
const rpc = vi.fn()
const client = { rpc } as unknown as SupabaseClient
const transport = vi.fn<typeof fetch>()
const device = {
  id: deviceId,
  printerId,
  name: 'Zebra',
  version: '',
  pairedAt: '2026-10-22',
  lastSeenAt: null,
  printerReachable: null,
  lastError: '',
  revokedAt: null,
}
const printer = {
  id: printerId,
  name: 'Zebra',
  transport: 'weblink' as const,
  address: '',
  model: 'ZD420',
  dpi: 203 as const,
  active: false,
}
function context(role = 'owner', mfaRequired = false, id = tenantId) {
  vi.mocked(platformContext).mockResolvedValue({
    client,
    active: { id, role },
    mfaRequired,
  } as unknown as NonNullable<Awaited<ReturnType<typeof platformContext>>>)
}
const run = (action: 'connect' | 'configuration' = 'connect') =>
  manageHostedWeblink(client, { ...command, action }, { fetchImpl: transport })
const req = (body: unknown = command, origin = 'https://app.example.test') =>
  new Request('https://app.example.test/api/print/weblink/managed', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.stubEnv('KOMISIO_WEBLINK_MANAGEMENT_URL', 'https://print.example.test')
  vi.stubEnv('KOMISIO_WEBLINK_MANAGEMENT_SECRET', 's'.repeat(43))
  vi.stubEnv('KOMISIO_WEBLINK_SETUP_ENABLED', 'true')
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test')
  rpc.mockResolvedValue({ data: true })
  vi.mocked(readPrinters).mockResolvedValue([printer])
  vi.mocked(readPrintDevices).mockResolvedValue([device])
  vi.mocked(createPairingCode).mockResolvedValue({
    code: 'AAAAA-BBBBB',
    expiresAt: '2026-10-22',
  })
  transport.mockResolvedValue(Response.json({ state: 'ready', deviceId }))
  context()
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
it('authorizes in the database before any gateway access and reuses the existing identity', async () => {
  expect(await run()).toEqual({ ok: true, deviceId })
  expect(createPairingCode).not.toHaveBeenCalled()
  expect(rpc).toHaveBeenCalledWith('authorize_weblink_setup', {
    p_tenant: tenantId,
    p_printer: printerId,
    p_device: null,
  })
  expect(transport).toHaveBeenCalledTimes(1)
  rpc.mockResolvedValue({ error: { message: 'denied' } })
  await expect(run()).rejects.toThrow('FORBIDDEN')
  expect(transport).toHaveBeenCalledTimes(1)
})
it('prepares only an inactive printer, then confirms its exact database identity', async () => {
  vi.mocked(readPrintDevices)
    .mockResolvedValueOnce([])
    .mockResolvedValue([device])
  transport
    .mockResolvedValueOnce(Response.json({ state: 'absent', deviceId: null }))
    .mockResolvedValueOnce(Response.json({ state: 'ready', deviceId }))
  expect(await run()).toEqual({ ok: true, deviceId })
  expect(createPairingCode).toHaveBeenCalledTimes(1)
  const [url, init] = transport.mock.calls[1]
  expect(String(url)).toBe('https://print.example.test/manage/enroll')
  expect(JSON.parse(String(init?.body))).toEqual({
    tenantId,
    printerId,
    name: 'Zebra',
    code: 'AAAAA-BBBBB',
  })
  expect(init?.redirect).toBe('error')
  expect(rpc).toHaveBeenLastCalledWith('authorize_weblink_setup', {
    p_tenant: tenantId,
    p_printer: printerId,
    p_device: deviceId,
  })
})
it('resumes a lost enrollment response using the same gateway checkpoint without another pairing code', async () => {
  transport
    .mockResolvedValueOnce(Response.json({ state: 'pending', deviceId: null }))
    .mockResolvedValueOnce(Response.json({ state: 'ready', deviceId }))
  expect(await run()).toEqual({ ok: true, deviceId })
  expect(createPairingCode).not.toHaveBeenCalled()
  expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toEqual({
    tenantId,
    printerId,
    name: 'Zebra',
  })
})
it('refuses active replacement and unmanaged live devices', async () => {
  transport.mockImplementation(async () =>
    Response.json({ state: 'absent', deviceId: null }),
  )
  vi.mocked(readPrinters).mockResolvedValue([{ ...printer, active: true }])
  await expect(run()).rejects.toThrow('PAUSE_FIRST')
  vi.mocked(readPrinters).mockResolvedValue([printer])
  await expect(run()).rejects.toThrow('DEVICE_CONFLICT')
  expect(createPairingCode).not.toHaveBeenCalled()
})
it('only a revoked identity on an inactive printer can be replaced', async () => {
  vi.mocked(readPrintDevices)
    .mockResolvedValueOnce([{ ...device, revokedAt: '2026-10-22' }])
    .mockResolvedValue([device])
  transport.mockImplementation(async () =>
    Response.json({ state: 'ready', deviceId }),
  )
  await run()
  expect(
    JSON.parse(String(transport.mock.calls[1][1]?.body)).replaceDeviceId,
  ).toBe(deviceId)
})
it('rechecks membership and device revocation before returning the secret installation file', async () => {
  transport.mockImplementation(async (url) =>
    Response.json(
      String(url).endsWith('/lookup')
        ? { state: 'ready', deviceId }
        : { deviceId, configuration: 'secret installation content' },
    ),
  )
  expect(await run('configuration')).toEqual({
    ok: true,
    deviceId,
    configuration: 'secret installation content',
  })
  rpc
    .mockResolvedValueOnce({ data: true })
    .mockResolvedValueOnce({ data: false })
  await expect(run('configuration')).rejects.toThrow('FORBIDDEN')
  vi.mocked(readPrintDevices).mockResolvedValue([
    { ...device, revokedAt: '2026-10-22' },
  ])
  rpc.mockResolvedValue({ data: true })
  await expect(run('configuration')).rejects.toThrow('DEVICE_CONFLICT')
})
it('holds unknown gateway output and never exposes its response body', async () => {
  transport.mockResolvedValue(
    new Response('private upstream secret', { status: 500 }),
  )
  await expect(run()).rejects.toThrow('PRINT_MANAGED_REVIEW_REQUIRED')
  expect(createPairingCode).not.toHaveBeenCalled()
})
it.each([
  'http://print.example.test',
  'https://user:pass@print.example.test',
  'https://print.example.test/manage',
  'https://print.example.test/?key=x',
])('refuses invalid server endpoint %s', (url) => {
  vi.stubEnv('KOMISIO_WEBLINK_MANAGEMENT_URL', url)
  expect(managedWeblinkConfigured()).toBe(false)
})
it.each(['staff', 'readonly', 'seller', 'device'])(
  'route rejects %s before any side effect',
  async (role) => {
    context(role)
    expect((await POST(req())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  },
)
it('route requires same origin, MFA, active tenant and strict server-owned parameters', async () => {
  expect((await POST(req(command, 'https://evil.example.test'))).status).toBe(
    403,
  )
  context('owner', true)
  expect((await POST(req())).status).toBe(401)
  context('owner', false, deviceId)
  expect((await POST(req())).status).toBe(409)
  context()
  expect(
    (await POST(req({ ...command, url: 'https://evil.example.test' }))).status,
  ).toBe(400)
  vi.stubEnv('KOMISIO_WEBLINK_SETUP_ENABLED', 'false')
  expect((await POST(req())).status).toBe(404)
  expect(rpc).not.toHaveBeenCalled()
})
