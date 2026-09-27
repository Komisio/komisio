import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readPayoutRequestSellers } from '../../lib/engine/payout-request-sellers'

const tenant = '10000000-0000-4000-8000-000000000001'
const anna = '20000000-0000-4000-8000-000000000001',
  bo = '20000000-0000-4000-8000-000000000002',
  cara = '20000000-0000-4000-8000-000000000003'

const overviewRow = (id: string, name: string, availableOre: number) => ({
  id,
  name,
  contact: null,
  email: '',
  phone: '',
  city: '',
  createdAt: '2026-09-01T10:00:00+00:00',
  itemsTotal: 0,
  itemsSold: 0,
  availableOre: String(availableOre),
  reservedOre: '0',
  creditedOre: '0',
})

/** A client whose rpc answers by function name and whose table read is a recorded chain. */
function fakeClient(
  rpcAnswers: Record<string, unknown | ((args: unknown) => unknown)>,
  tableResult: unknown = { data: [], error: null },
) {
  const calls: { rpc: [string, unknown][]; table: string[] } = {
    rpc: [],
    table: [],
  }
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(tableResult)),
  }
  const client = {
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push([name, args])
      const answer = rpcAnswers[name]
      return typeof answer === 'function' ? answer(args) : answer
    }),
    from: vi.fn((table: string) => {
      calls.table.push(table)
      return chain
    }),
  }
  return { client: client as unknown as SupabaseClient, calls, chain }
}

describe('readPayoutRequestSellers', () => {
  it('reads all fifty balances in one overview call and keeps zero balances', async () => {
    const { client, calls } = fakeClient({
      sellers_overview: {
        data: {
          sellers: [
            overviewRow(anna, 'Anna', 16000),
            overviewRow(bo, 'Bo', 0),
            overviewRow(cara, 'Cara', 250),
          ],
          total: 3,
          limit: 50,
        },
        error: null,
      },
    })
    expect(await readPayoutRequestSellers(client, tenant)).toEqual([
      { id: anna, name: 'Anna', availableOre: 16000 },
      { id: bo, name: 'Bo', availableOre: 0 },
      { id: cara, name: 'Cara', availableOre: 250 },
    ])
    expect(calls.rpc).toEqual([
      ['sellers_overview', { p_tenant: tenant, p_query: '', p_limit: 50 }],
    ])
    expect(calls.table).toEqual([])
  })

  it('falls back to the table read plus one balance per seller only when the overview function is missing', async () => {
    const balances: Record<string, number> = {
      [anna]: 16000,
      [bo]: 0,
      [cara]: 250,
    }
    const { client, calls, chain } = fakeClient(
      {
        sellers_overview: { data: null, error: { code: 'PGRST202' } },
        seller_balance: (args: unknown) => {
          const { p_seller } = args as { p_seller: string }
          return {
            data: {
              sellerId: p_seller,
              availableOre: balances[p_seller],
              reservedOre: 0,
              creditedOre: balances[p_seller],
              paidOre: 0,
              entries: 1,
            },
            error: null,
          }
        },
      },
      {
        data: [
          { id: anna, name: 'Anna' },
          { id: bo, name: 'Bo' },
          { id: cara, name: 'Cara' },
        ],
        error: null,
      },
    )
    expect(await readPayoutRequestSellers(client, tenant)).toEqual([
      { id: anna, name: 'Anna', availableOre: 16000 },
      { id: bo, name: 'Bo', availableOre: 0 },
      { id: cara, name: 'Cara', availableOre: 250 },
    ])
    expect(calls.table).toEqual(['sellers'])
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', tenant)
    expect(chain.order.mock.calls).toEqual([['name'], ['id']])
    expect(chain.limit).toHaveBeenCalledWith(50)
    expect(calls.rpc.map(([name]) => name)).toEqual([
      'sellers_overview',
      'seller_balance',
      'seller_balance',
      'seller_balance',
    ])
  })

  it('propagates a forbidden overview read instead of falling back or emptying the list', async () => {
    const { client, calls } = fakeClient({
      sellers_overview: { data: null, error: { code: '42501' } },
    })
    await expect(readPayoutRequestSellers(client, tenant)).rejects.toThrow(
      'FORBIDDEN',
    )
    expect(calls.table).toEqual([])
  })

  it('propagates a failed table read in the fallback', async () => {
    const { client } = fakeClient(
      { sellers_overview: { data: null, error: { code: 'PGRST202' } } },
      { data: null, error: { message: 'connection reset' } },
    )
    await expect(readPayoutRequestSellers(client, tenant)).rejects.toThrow(
      'Unable to read sellers',
    )
  })

  it('propagates a failed balance read in the fallback', async () => {
    const { client } = fakeClient(
      {
        sellers_overview: { data: null, error: { code: 'PGRST202' } },
        seller_balance: {
          data: null,
          error: { code: '42501', message: 'permission denied' },
        },
      },
      { data: [{ id: anna, name: 'Anna' }], error: null },
    )
    await expect(readPayoutRequestSellers(client, tenant)).rejects.toThrow(
      'FORBIDDEN',
    )
  })

  it('rejects a malformed tenant id before reading anything', async () => {
    const { client, calls } = fakeClient({})
    await expect(
      readPayoutRequestSellers(client, 'not-a-tenant'),
    ).rejects.toThrow()
    expect(calls.rpc).toEqual([])
    expect(calls.table).toEqual([])
  })
})
