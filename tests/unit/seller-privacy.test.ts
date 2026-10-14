import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  eraseSellerContact,
  eraseSellerContactCommand,
} from '../../lib/engine/seller-privacy'

const command = {
  action: 'erase' as const,
  tenantId: '97000000-0000-4000-8000-000000000001',
  sellerId: '97000000-0000-4000-8000-000000000002',
  requestId: '97000000-0000-4000-8000-000000000003',
  revision: 'a'.repeat(64),
  reason: 'Accounting evidence retained for review',
  reviewOn: '2027-01-01',
  confirmed: true as const,
}
it('requires explicit, bounded review and rejects extra mutation fields', () => {
  for (const override of [
    { confirmed: false },
    { reason: '' },
    { reason: 'x'.repeat(1001) },
    { reviewOn: '2027-02-30' },
    { revision: '' },
    { action: 'deleteAccount' },
    { deleteAuth: true },
    { tenantId: 'invalid' },
  ])
    expect(
      eraseSellerContactCommand.safeParse({ ...command, ...override }).success,
    ).toBe(false)
})
it('binds the reviewed request to the engine, with no automatic retry', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: command.requestId })
  const client = { rpc } as unknown as SupabaseClient
  expect(await eraseSellerContact(client, command)).toBe(command.requestId)
  expect(rpc).toHaveBeenCalledExactlyOnceWith('erase_seller_contact', {
    p_tenant: command.tenantId,
    p_id: command.requestId,
    p_seller: command.sellerId,
    p_revision: command.revision,
    p_reason: command.reason,
    p_review_on: command.reviewOn,
    p_confirm: true,
  })
  rpc
    .mockClear()
    .mockResolvedValue({ error: { message: 'Private database details' } })
  await expect(eraseSellerContact(client, command)).rejects.toThrow(
    'REQUEST_FAILED',
  )
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('retention follow-up cannot call the erasure operation', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: command.requestId })
  await eraseSellerContact({ rpc } as unknown as SupabaseClient, {
    ...command,
    action: 'review',
  })
  expect(rpc.mock.calls[0][0]).toBe('review_seller_retention')
})
