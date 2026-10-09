import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  acceptMySellerAgreement,
  sellerAgreementCommand,
  sellerAgreementState,
} from '../../lib/engine/seller-agreement'
const command = {
  tenantId: '28600000-0000-4000-8000-000000000001',
  sellerId: '28600000-0000-4000-8000-000000000002',
  requestId: '28600000-0000-4000-8000-000000000003',
  agreementId: '28600000-0000-4000-8000-000000000004',
}
describe('seller agreement boundary', () => {
  it('does not accept caller-supplied identity or evidence', () => {
    expect(
      sellerAgreementCommand.safeParse({
        ...command,
        acceptedBy: command.tenantId,
      }).success,
    ).toBe(false)
    expect(
      sellerAgreementCommand.safeParse({ ...command, agreementId: '' }).success,
    ).toBe(false)
  })
  it('passes the pinned version and retry identity to the engine', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: command.requestId, error: null })
    await acceptMySellerAgreement({ rpc } as unknown as SupabaseClient, command)
    expect(rpc).toHaveBeenCalledWith('accept_my_seller_agreement', {
      p_tenant: command.tenantId,
      p_seller: command.sellerId,
      p_id: command.requestId,
      p_agreement: command.agreementId,
    })
  })
  it('requires a known evidence source instead of guessing who accepted', () => {
    expect(
      sellerAgreementState.safeParse({
        agreement: null,
        acceptance: {
          id: command.requestId,
          at: '2026-10-09',
          source: 'unknown',
        },
      }).success,
    ).toBe(false)
  })
})
