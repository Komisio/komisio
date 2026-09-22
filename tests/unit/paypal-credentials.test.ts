import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  connectPayPal,
  paypalEnvironment,
} from '../../lib/engine/paypal-credentials'
import { open, seal } from '../../lib/platform/credentials'

const tenant = 'f1460000-0000-4000-8000-000000000001'
const other = 'f1460000-0000-4000-8000-000000000002'
const merchant = 'f1460000-0000-4000-8000-000000000010'
const env = { KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32) }
const input = { clientId: 'test-client', apiKey: 'test-api-key' }
const client = (rpc: ReturnType<typeof vi.fn>) =>
  ({ rpc }) as unknown as SupabaseClient

describe('tenant PayPal credentials', () => {
  it('verifies the account before storing tenant-bound ciphertext, without enabling sync', async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: name === 'tenant_role' ? 'owner' : null,
      error: null,
    }))
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ access_token: 'test-access', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(Response.json({ organizationUuid: merchant }))
    const result = await connectPayPal(client(rpc), tenant, input, env, http)
    expect(result).toEqual({ organizationId: merchant, merchantPinned: true })
    const saved = rpc.mock.calls.find(
      ([name]) => name === 'store_paypal_credentials',
    )
    expect(saved).toBeDefined()
    const args = (saved as unknown as [string, { p_cipher: unknown }])[1]
    expect(JSON.stringify(args)).not.toContain(input.apiKey)
    expect(open(`paypal-credentials:${tenant}`, args.p_cipher, env)).toEqual(
      input,
    )
    expect(rpc.mock.calls.some(([name]) => name === 'enable_zettle_pull')).toBe(
      false,
    )
  })
  it('rejects staff before contacting the provider', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'staff', error: null })
    const http = vi.fn<typeof fetch>()
    await expect(
      connectPayPal(client(rpc), tenant, input, env, http),
    ).rejects.toThrow('FORBIDDEN')
    expect(http).not.toHaveBeenCalled()
  })
  it('does not save rejected credentials', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'owner', error: null })
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('private provider failure', { status: 401 }),
      )
    await expect(
      connectPayPal(client(rpc), tenant, input, env, http),
    ).rejects.toThrow('ZETTLE_AUTH_REQUIRED')
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('uses this tenant’s credentials ahead of deployment values and rejects copied ciphertext', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        merchantId: merchant,
        cipher: seal(`paypal-credentials:${tenant}`, input, env),
      },
      error: null,
    })
    const resolved = await paypalEnvironment(client(rpc), tenant, {
      ...env,
      ZETTLE_PILOT_TENANT_ID: other,
      ZETTLE_API_KEY: 'other-secret',
    })
    expect(resolved.ZETTLE_PILOT_TENANT_ID).toBe(tenant)
    expect(resolved.ZETTLE_API_KEY).toBe(input.apiKey)
    await expect(paypalEnvironment(client(rpc), other, env)).rejects.toThrow(
      'CREDENTIAL_UNREADABLE',
    )
  })
  it('fails closed on database denial instead of falling back to deployment credentials', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(paypalEnvironment(client(rpc), tenant, env)).rejects.toThrow(
      'FORBIDDEN',
    )
  })
})
