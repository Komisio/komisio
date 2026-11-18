import { afterEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeCentralReview,
  centralReviewCommand,
} from '../../lib/engine/central-item-review'
import { executeCentralIntakeProfile } from '../../lib/engine/central-intake-profile'
import { renderSellerPush } from '../../lib/push/copy'
const book = vi.hoisted(() => vi.fn())
vi.mock('../../lib/platform/postnord', () => ({ bookPostNordParcel: book }))
const id = (n: number) =>
  `f8580000-0000-4000-8000-${String(n).padStart(12, '0')}`
const command = {
  action: 'approveAndBook',
  tenantId: id(1),
  commandId: id(2),
  ownerId: id(3),
  expectedRevision: 1,
  items: [{ requestId: id(4), expectedSalePriceOre: '100000' }],
}
const contact = {
  name: 'Synthetic Sender',
  street: 'Test 1',
  postalCode: '12345',
  city: 'Teststad',
  country: 'SE',
  phone: '+46700000000',
  email: 'synthetic@example.test',
}
const parcel = {
  id: id(2),
  reference: 'P-1',
  environment: 'sandbox',
  serviceCode: '11',
  estimatedWeightG: 450,
  sender: contact,
  recipient: contact,
  weightG: null,
  lengthMm: null,
  widthMm: null,
  heightMm: null,
  status: 'pending',
  booking: null,
  createdAt: '2026-11-18T00:00:00Z',
  items: [],
}
const config = {
  environment: 'sandbox' as const,
  serverKey: 'synthetic',
  apiKey: 'synthetic',
  customerNumber: '1234567890',
}
const result = {
  bookingId: 'synthetic',
  returnId: 'synthetic',
  trackingId: '12345',
  qrPng: 'data:image/png;base64,iVBORw0KGgo=',
}
afterEach(() => vi.resetAllMocks())
function fixture(dispatch = true) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'review_central_item_group'
        ? { dispatch, parcel, handoverReference: 'H-1', messageId: 'K1' }
        : null,
    error: null,
  }))
  return { rpc, client: { rpc } as unknown as SupabaseClient }
}
it('books once after the database claim and preserves the provider result', async () => {
  const f = fixture()
  book.mockResolvedValue(result)
  expect(await executeCentralReview(f.client, command, config)).toEqual({
    id: id(2),
    shippingStatus: 'booked',
  })
  expect(book).toHaveBeenCalledOnce()
  expect(f.rpc).toHaveBeenLastCalledWith('finish_staff_central_parcel', {
    p_id: id(2),
    p_result: result,
  })
  const retry = fixture(false)
  expect(await executeCentralReview(retry.client, command, config)).toEqual({
    id: id(2),
    shippingStatus: 'pending',
  })
  expect(book).toHaveBeenCalledOnce()
  expect(retry.rpc).toHaveBeenCalledOnce()
})
it('holds an unknown carrier response without a second booking', async () => {
  const f = fixture()
  book.mockRejectedValue(new Error('lost reply'))
  expect(await executeCentralReview(f.client, command, config)).toEqual({
    id: id(2),
    shippingStatus: 'needs_review',
  })
  expect(f.rpc).toHaveBeenLastCalledWith('finish_staff_central_parcel', {
    p_id: id(2),
    p_result: null,
  })
  await executeCentralReview(fixture(false).client, command, config)
  expect(book).toHaveBeenCalledOnce()
})
it('can approve without configured shipping, but never dispatches without configuration', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { id: id(2), dispatch: false, parcel: null },
    error: null,
  })
  expect(
    await executeCentralReview(
      { rpc } as unknown as SupabaseClient,
      { ...command, action: 'approve' },
      null,
    ),
  ).toEqual({ id: id(2), shippingStatus: null })
  await expect(
    executeCentralReview({ rpc } as unknown as SupabaseClient, command, null),
  ).rejects.toThrow('SHIPPING_UNAVAILABLE')
  expect(rpc).toHaveBeenCalledOnce()
  expect(book).not.toHaveBeenCalled()
})
it('never lets staff supply a replacement seller amount, recipient or duplicate item', () => {
  for (const c of [
    { ...command, sellerAmountOre: '1' },
    { ...command, recipient: contact },
    { ...command, items: [...command.items, ...command.items] },
    {
      ...command,
      items: [{ ...command.items[0], expectedSalePriceOre: '1.5' }],
    },
  ])
    expect(centralReviewCommand.safeParse(c).success).toBe(false)
})
it('profile saves bind the tenant, revision and exact agreement without bank details', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: id(2), error: null })
  const c = {
    action: 'save',
    requestId: id(2),
    tenantId: id(1),
    agreementVersionId: id(5),
    expectedRevision: -1,
    address: { street: 'Test 1', postalCode: '12345', city: 'Teststad' },
    contact: {
      firstName: 'Synthetic',
      lastName: 'Sender',
      phone: contact.phone,
    },
    acceptAgreement: true,
  }
  await expect(
    executeCentralIntakeProfile({ rpc } as unknown as SupabaseClient, c),
  ).resolves.toEqual({ id: id(2) })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('save_central_intake_profile', {
    p_id: id(2),
    p_tenant: id(1),
    p_agreement: id(5),
    p_expected: -1,
    p_address: c.address,
    p_contact: c.contact,
    p_accept: true,
  })
  await expect(
    executeCentralIntakeProfile({ rpc } as unknown as SupabaseClient, {
      ...c,
      ownerId: id(9),
    }),
  ).rejects.toThrow()
})
it('approval push is a decision, while legacy offers retain their copy', () => {
  expect(
    renderSellerPush('external_item_offered', 'sv', '', '', true).title,
  ).toBe('Komisio har godkänt din vara')
  expect(renderSellerPush('external_item_offered', 'sv', '', '').title).toBe(
    'Du har fått ett erbjudande',
  )
})
