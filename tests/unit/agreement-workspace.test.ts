import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { intakeCommand, executeIntake } from '../../lib/engine/intake'
import { initialSellerProfile } from '../../lib/engine/seller-profile'
const tenantId = '30100000-0000-4000-8000-000000000001',
  requestId = '30100000-0000-4000-8000-000000000002',
  agreementId = '30100000-0000-4000-8000-000000000003'
describe('seller agreement registration boundary', () => {
  const registration = {
    action: 'registerSeller',
    tenantId,
    requestId,
    name: 'TEST seller',
    email: '',
    phone: '123',
    agreementApproval: { agreementId, reference: ' Paper TEST ' },
  }
  it('requires exact version and nonempty retained evidence', () => {
    expect(intakeCommand.parse(registration)).toMatchObject({
      agreementApproval: { agreementId, reference: 'Paper TEST' },
    })
    expect(
      intakeCommand.safeParse({
        ...registration,
        agreementApproval: { agreementId, reference: ' ' },
      }).success,
    ).toBe(false)
    expect(
      intakeCommand.safeParse({
        ...registration,
        agreementApproval: { reference: 'Paper' },
      }).success,
    ).toBe(false)
  })
  it('uses the atomic registration path only for explicit evidence', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: requestId, error: null }),
      client = { rpc } as unknown as SupabaseClient
    await executeIntake(client, registration)
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'save_seller_with_agreement',
      expect.objectContaining({
        p_tenant: tenantId,
        p_id: requestId,
        p_seller: null,
        p_expected: null,
        p_agreement: agreementId,
        p_reference: 'Paper TEST',
      }),
    )
    rpc.mockClear()
    await executeIntake(client, {
      ...registration,
      agreementApproval: undefined,
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'register_seller',
      expect.any(Object),
    )
  })
  it('binds profile revision and agreement evidence in one call', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: requestId, error: null }),
      client = { rpc } as unknown as SupabaseClient
    const profile = initialSellerProfile(registration)
    await executeIntake(client, {
      action: 'saveSellerProfile',
      tenantId,
      requestId,
      sellerId: requestId,
      expectedRevision: 2,
      profile,
      agreementApproval: registration.agreementApproval,
    })
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'save_seller_with_agreement',
      expect.objectContaining({
        p_seller: requestId,
        p_expected: 2,
        p_profile: profile,
        p_agreement: agreementId,
      }),
    )
  })
})
