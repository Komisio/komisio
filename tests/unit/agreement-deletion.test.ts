import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  agreementDeleteInput,
  agreementLinkSummary,
  deleteUnusedSellerAgreement,
} from '../../lib/engine/agreement-deletion'

const input = {
  tenantId: '49000000-0000-4000-8000-000000000001',
  agreementId: '49000000-0000-4000-8000-000000000010',
}
describe('unused agreement deletion', () => {
  it('rejects extra fields and ids that are not agreements', () => {
    expect(agreementDeleteInput.safeParse(input).success).toBe(true)
    for (const invalid of [
      { ...input, force: true },
      { ...input, agreementId: 'version-1' },
      { tenantId: input.tenantId },
    ])
      expect(agreementDeleteInput.safeParse(invalid).success).toBe(false)
  })
  it('returns a refusal with the same agreement and hides database text', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { ok: false, usage: { sellers: 2, receipts: 1 } },
      error: null,
    })
    expect(
      await deleteUnusedSellerAgreement(
        { rpc } as unknown as SupabaseClient,
        input,
      ),
    ).toEqual({ ok: false, usage: { sellers: 2, receipts: 1 } })
    expect(rpc).toHaveBeenCalledWith('delete_unused_seller_agreement', {
      p_tenant: input.tenantId,
      p_agreement: input.agreementId,
    })
    expect(
      agreementLinkSummary(
        { sellers: 2, receipts: 1 },
        {
          sellers: 'Sellers',
          receipts: 'Drop-offs',
          reviews: 'Reviews',
          items: 'Items',
          sales: 'Sales',
        },
      ),
    ).toBe('Sellers: 2 · Drop-offs: 1')
    rpc.mockResolvedValue({
      data: {
        ok: true,
        agreementId: '49000000-0000-4000-8000-000000000099',
      },
      error: null,
    })
    await expect(
      deleteUnusedSellerAgreement({ rpc } as unknown as SupabaseClient, input),
    ).rejects.toThrow('REQUEST_FAILED')
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'private table detail' },
    })
    await expect(
      deleteUnusedSellerAgreement({ rpc } as unknown as SupabaseClient, input),
    ).rejects.toThrow('REQUEST_FAILED')
  })
})
