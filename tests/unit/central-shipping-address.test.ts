import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  centralAddressCommand,
  executeCentralShippingAddress,
} from '../../lib/engine/central-shipping-address'
const id = 'f7800000-0000-4000-8000-000000000701',
  tenant = 'f7800000-0000-4000-8000-000000000801',
  seller = 'f7800000-0000-4000-8000-000000000802'
const command = {
  action: 'save',
  requestId: id,
  tenantId: tenant,
  sellerId: seller,
  expectedRevision: 0,
  address: { street: 'Testgatan 1', postalCode: '12345', city: 'Teststad' },
}
describe('central shipping address', () => {
  it('accepts address fields only and keeps writes in the owner-bound engine RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: id, error: null })
    expect(
      await executeCentralShippingAddress(
        { rpc } as unknown as SupabaseClient,
        command,
      ),
    ).toEqual({ id })
    expect(rpc).toHaveBeenCalledWith('save_my_central_shipping_address', {
      p_id: id,
      p_tenant: tenant,
      p_seller: seller,
      p_expected: 0,
      p_address: command.address,
    })
    for (const extra of [
      { email: 'injected@example.test' },
      { expectedRevision: -1 },
      { address: { ...command.address, country: 'DE' } },
    ])
      expect(
        centralAddressCommand.safeParse({ ...command, ...extra }).success,
      ).toBe(false)
  })
  it('reads only safe address projection, preserves null and rejects mismatched results', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        account: {
          tenantId: tenant,
          sellerId: seller,
          revision: 1,
          address: command.address,
          notes: 'private',
        },
      },
      error: null,
    })
    const r = await executeCentralShippingAddress(
      { rpc } as unknown as SupabaseClient,
      { action: 'read' },
    )
    expect(r).toEqual({
      account: {
        tenantId: tenant,
        sellerId: seller,
        revision: 1,
        address: command.address,
      },
    })
    rpc.mockResolvedValueOnce({ data: seller, error: null })
    await expect(
      executeCentralShippingAddress(
        { rpc } as unknown as SupabaseClient,
        command,
      ),
    ).rejects.toThrow('REQUEST_FAILED')
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PROFILE_CHANGED' },
    })
    await expect(
      executeCentralShippingAddress(
        { rpc } as unknown as SupabaseClient,
        command,
      ),
    ).rejects.toThrow('PROFILE_CHANGED')
  })
})
