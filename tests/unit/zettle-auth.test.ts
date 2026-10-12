import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pilotAvailable,
  pilotIssue,
  verifyPilotConnection,
  connectedPilotClient,
  connectedPilotCatalog,
} from '../../extensions/zettle/auth'
import { checkZettleConnection } from '../../lib/engine/zettle-connection'
const tenant = '10000000-0000-4000-8000-000000000001',
  merchant = '20000000-0000-4000-8000-000000000001'
const env = () => ({
  ZETTLE_PILOT_TENANT_ID: tenant,
  ZETTLE_MERCHANT_ID: merchant,
  ZETTLE_ACCESS_TOKEN: 'synthetic-access',
  ZETTLE_ACCESS_EXPIRES_AT: String(Date.now() + 7200000),
})
const ready = () =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ organizationUuid: merchant }))
it('verifies the pinned merchant using a server token, without returning credentials', async () => {
  const http = ready()
  const result = await verifyPilotConnection(tenant, env(), http)
  expect(http).toHaveBeenCalledOnce()
  expect(http.mock.calls[0][0]).toBe('https://oauth.zettle.com/users/self')
  expect(http.mock.calls[0][1]).toMatchObject({
    headers: { Authorization: 'Bearer synthetic-access' },
    cache: 'no-store',
    redirect: 'error',
  })
  expect(result).toMatchObject({
    organizationId: merchant,
    merchantPinned: true,
  })
  expect(JSON.stringify(result)).not.toContain('synthetic')
})
it.each([
  { ZETTLE_ACCESS_TOKEN: '' },
  { ZETTLE_ACCESS_TOKEN: 'x\r\ny' },
  { ZETTLE_MERCHANT_ID: undefined },
  { ZETTLE_MERCHANT_ID: 'invalid' },
  { ZETTLE_PILOT_TENANT_ID: merchant },
  { ZETTLE_ACCESS_EXPIRES_AT: '0' },
])('refuses invalid token envelopes before HTTP: %j', async (patch) => {
  const http = ready()
  expect(pilotAvailable(tenant, { ...env(), ...patch })).toBe(false)
  await expect(
    verifyPilotConnection(tenant, { ...env(), ...patch }, http),
  ).rejects.toThrow('ZETTLE_NOT_CONNECTED')
  expect(http).not.toHaveBeenCalled()
})
it('refuses another merchant', async () => {
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ organizationUuid: tenant }))
  await expect(verifyPilotConnection(tenant, env(), http)).rejects.toThrow(
    'ZETTLE_WRONG_MERCHANT',
  )
})
it.each(['staff', 'readonly', null])(
  'checks SQL authorization before provider access: %s',
  async (role) => {
    const rpc = vi.fn().mockResolvedValue({ data: role, error: null }),
      http = ready()
    await expect(
      checkZettleConnection(
        { rpc } as unknown as SupabaseClient,
        tenant,
        env(),
        http,
      ),
    ).rejects.toThrow('FORBIDDEN')
    expect(http).not.toHaveBeenCalled()
  },
)
it.each([401, 403, 500])('sanitizes identity errors %s', async (status) => {
  const http = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('secret-provider-data', { status }))
  await expect(verifyPilotConnection(tenant, env(), http)).rejects.toThrow(
    'ZETTLE_AUTH_REQUIRED',
  )
})
it('returns only one safe unavailable diagnostic', () => {
  expect(pilotIssue(tenant, env())).toBeNull()
  expect(pilotIssue(merchant, env())).toBe('connectionUnavailable')
})
it('keeps tokens private and binds purchase windows', async () => {
  const http = ready()
    .mockResolvedValueOnce(Response.json({ organizationUuid: merchant }))
    .mockResolvedValueOnce(Response.json({ organizationUuid: merchant }))
    .mockResolvedValueOnce(Response.json({ purchases: [] }))
  const client = await connectedPilotClient(
    tenant,
    env(),
    { startDate: '2026-01-01T00:00:00Z', endDate: '2026-01-02T00:00:00Z' },
    http,
  )
  expect(Object.keys(client).sort()).toEqual(['fetchPage', 'putProduct'])
  await client.fetchPage({ cursor: null, signal: new AbortController().signal })
  const url = new URL(String(http.mock.calls[2][0]))
  expect(url.origin).toBe('https://purchase.izettle.com')
  expect(url.searchParams.get('startDate')).toBe('2026-01-01T00:00:00Z')
})
it('expired transport leases stop instead of reusing expired tokens', async () => {
  vi.useFakeTimers()
  try {
    const http = ready()
    const client = await connectedPilotCatalog(tenant, env(), http)
    expect(Object.keys(client).sort()).toEqual(['inventory', 'putProduct'])
    vi.advanceTimersByTime(7200000)
    await expect(client.inventory.inventories()).rejects.toThrow(
      'ZETTLE_NOT_CONNECTED',
    )
    expect(http).toHaveBeenCalledOnce()
  } finally {
    vi.useRealTimers()
  }
})
