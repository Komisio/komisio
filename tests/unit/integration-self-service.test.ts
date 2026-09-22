import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  startFortnoxConnection,
  completeFortnoxConnection,
} from '../../lib/engine/fortnox-connection'
import { startShopifyConnection } from '../../lib/engine/shopify-connection'
import { verifyState } from '../../lib/platform/credentials'

const tenant = 'f1460000-0000-4000-8000-000000000002'
const env = {
  KOMISIO_CREDENTIAL_KEY: 'ab'.repeat(32),
  FORTNOX_CLIENT_ID: 'test-client',
  FORTNOX_CLIENT_SECRET: 'test-secret',
  SHOPIFY_CLIENT_ID: 'test-client',
  SHOPIFY_CLIENT_SECRET: 'test-secret',
}
function fixture(role = 'owner', companyName: string | null = null) {
  const rpc = vi.fn(async (name: string) => ({
    error: null,
    data:
      name === 'tenant_role'
        ? role
        : name === 'fortnox_connection_status'
          ? {
              connected: companyName !== null,
              companyName,
              databaseNumber: companyName ? '123' : null,
              organisationNumber: null,
              scope: null,
              connectedAt: null,
              refreshedAt: null,
              events: [],
            }
          : null,
  }))
  return { rpc, client: { rpc } as unknown as SupabaseClient }
}
describe('own accounts per tenant', () => {
  it('binds the selected Fortnox company to signed state without a deployment tenant', async () => {
    const f = fixture()
    const started = await startFortnoxConnection(
      f.client,
      tenant,
      'https://example.test/callback',
      env,
      'My store',
    )
    expect(verifyState('fortnox-connection', started.state, env)).toEqual({
      tenantId: tenant,
      companyName: 'My store',
      databaseNumber: '',
    })
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          CompanyInformation: {
            CompanyName: 'My store',
            OrganizationNumber: '123',
            DatabaseNumber: 123,
          },
        }),
      )
    await completeFortnoxConnection(
      f.client,
      { code: 'test-code', state: started.state, cookieState: started.state },
      'https://example.test/callback',
      env,
      http,
    )
    expect(f.rpc).toHaveBeenCalledWith(
      'store_fortnox_connection',
      expect.objectContaining({
        p_tenant: tenant,
        p_database_number: '123',
        p_company_name: 'My store',
      }),
    )
  })
  it('rejects the wrong company even with a valid OAuth exchange', async () => {
    const f = fixture()
    const started = await startFortnoxConnection(
      f.client,
      tenant,
      'https://example.test/callback',
      env,
      'My store',
    )
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          CompanyInformation: {
            CompanyName: 'Another store',
            OrganizationNumber: '123',
            DatabaseNumber: 123,
          },
        }),
      )
    await expect(
      completeFortnoxConnection(
        f.client,
        { code: 'test-code', state: started.state, cookieState: started.state },
        'https://example.test/callback',
        env,
        http,
      ),
    ).rejects.toThrow('FORTNOX_WRONG_COMPANY')
    expect(
      f.rpc.mock.calls.some(([name]) => name === 'store_fortnox_connection'),
    ).toBe(false)
  })
  it('reconnects only the stored Fortnox company regardless of edited query input', async () => {
    const started = await startFortnoxConnection(
      fixture('owner', 'Pinned store').client,
      tenant,
      'https://example.test/callback',
      env,
      'Other store',
    )
    expect(verifyState('fortnox-connection', started.state, env)).toEqual({
      tenantId: tenant,
      companyName: 'Pinned store',
      databaseNumber: '123',
    })
  })
  it('binds a Shopify shop to the store without a deployment tenant and rejects staff', async () => {
    const started = await startShopifyConnection(
      fixture().client,
      tenant,
      'own-shop.myshopify.com',
      'https://example.test/callback',
      env,
    )
    expect(verifyState('shopify-connection', started.state, env)).toEqual({
      tenantId: tenant,
      shop: 'own-shop.myshopify.com',
    })
    await expect(
      startShopifyConnection(
        fixture('staff').client,
        tenant,
        'own-shop.myshopify.com',
        'https://example.test/callback',
        env,
      ),
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      startFortnoxConnection(
        fixture('staff').client,
        tenant,
        'https://example.test/callback',
        env,
        'My store',
      ),
    ).rejects.toThrow('FORBIDDEN')
  })
})
