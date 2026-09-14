import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readSellerMatches,
  readSellersOverview,
  sellerMatches,
  sellersOverview,
} from '../../lib/engine/sellers'

const tenant = '10000000-0000-4000-8000-000000000001'
const seller = '10000000-0000-4000-8000-000000000002'

describe('sellers', () => {
  it('parses the overview with money as numbers whatever the driver returns', () => {
    const parsed = sellersOverview.parse({
      sellers: [
        {
          id: seller,
          name: 'Anna',
          contact: null,
          createdAt: '2026-09-14T10:00:00+00:00',
          itemsTotal: 2,
          itemsSold: 1,
          availableOre: '12300',
          reservedOre: 0,
          creditedOre: 12300,
        },
      ],
      total: 1,
      limit: 50,
    })
    expect(parsed.sellers[0].availableOre).toBe(12300)
    expect(() =>
      sellersOverview.parse({ sellers: [], total: 'many', limit: 50 }),
    ).toThrow()
  })
  it('bounds the search and treats a missing function as no list', async () => {
    const rpc = vi.fn(async () => ({
      data: { sellers: [], total: 0, limit: 50 },
      error: null,
    }))
    const client = { rpc } as unknown as SupabaseClient
    await readSellersOverview(client, tenant, `  ${'x'.repeat(200)}  `)
    expect(rpc).toHaveBeenCalledWith('sellers_overview', {
      p_tenant: tenant,
      p_query: 'x'.repeat(120),
      p_limit: 50,
    })
    const gap = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })),
    } as unknown as SupabaseClient
    expect(await readSellersOverview(gap, tenant, '')).toBeNull()
  })
  it('validates matches and their reasons', () => {
    expect(
      sellerMatches.safeParse({
        matches: [
          { id: seller, name: 'Anna', contact: 'a@x.test', reasons: ['email'] },
        ],
      }).success,
    ).toBe(true)
    expect(
      sellerMatches.safeParse({
        matches: [
          { id: seller, name: 'Anna', contact: null, reasons: ['ssn'] },
        ],
      }).success,
    ).toBe(false)
  })
  it('finds nothing during the deploy gap and refuses other errors', async () => {
    const gap = {
      rpc: vi.fn(async () => ({ data: null, error: { code: 'PGRST202' } })),
    } as unknown as SupabaseClient
    expect(
      await readSellerMatches(gap, tenant, {
        name: '',
        email: 'a@x.test',
        phone: '',
      }),
    ).toEqual({ matches: [] })
    const denied = {
      rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    } as unknown as SupabaseClient
    await expect(
      readSellerMatches(denied, tenant, {
        name: '',
        email: 'a@x.test',
        phone: '',
      }),
    ).rejects.toThrow('FORBIDDEN')
  })
})
