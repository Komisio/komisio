import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSellerLedger } from '../../lib/engine/seller-ledger'
import { readStatement } from '../../lib/engine/statements'
import { readSellerCommunications } from '../../lib/engine/communications'

const id = '11111111-1111-4111-8111-111111111111'
const legacy = 'abcdef12-3456-f789-0123-456789abcdef'
const when = '2026-09-25T00:00:00Z'
function clientFor(data: unknown) {
  const result = { data, error: null }
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
    then: Promise.resolve(result).then.bind(Promise.resolve(result)),
  }
  for (const key of ['select', 'eq', 'order', 'limit'] as const)
    query[key].mockReturnValue(query)
  query.maybeSingle.mockResolvedValue(result)
  return {
    rpc: vi.fn().mockResolvedValue(result),
    from: vi.fn().mockReturnValue(query),
    query,
  }
}
const ledger = {
  id,
  kind: 'credit_sale',
  amount_ore: '3160',
  reference_kind: 'sale_line',
  reference_id: legacy,
  reason: '',
  occurred_at: when,
}
const communication = {
  id,
  kind: 'item_sold',
  locale: 'sv',
  recipient: 'seller@example.test',
  subject: 'Test',
  body: 'Test',
  reference_kind: 'sale_line',
  reference_id: legacy,
  status: 'sent',
  queued_at: when,
  delivered_at: when,
}
const statement = {
  id,
  seller_id: id,
  number: 1,
  kind: 'statement',
  corrects_id: null,
  period_from: when,
  period_to: when,
  opening_ore: 0,
  sales_gross_ore: 0,
  commission_ore: 0,
  credited_ore: 3160,
  reversed_ore: 0,
  paid_ore: 0,
  adjustments_ore: 0,
  closing_ore: 3160,
  issued_at: when,
}

it('reads historical ledger references without altering IDs or balances', async () => {
  const client = clientFor([ledger])
  const rows = await readSellerLedger(
    client as unknown as SupabaseClient,
    id,
    id,
  )
  expect(rows[0]).toMatchObject({ reference_id: legacy, amount_ore: 3160 })
  expect(client.rpc).toHaveBeenCalledWith('seller_ledger_page', {
    p_tenant: id,
    p_seller: id,
  })
})
it('reads the same historical references in messages and issued statements', async () => {
  const messages = clientFor([communication])
  expect(
    (
      await readSellerCommunications(
        messages as unknown as SupabaseClient,
        id,
        id,
      )
    )[0].reference_id,
  ).toBe(legacy)
  expect(messages.query.eq).toHaveBeenCalledWith('tenant_id', id)
  expect(messages.query.eq).toHaveBeenCalledWith('seller_id', id)
  const head = clientFor(statement),
    lines = clientFor([
      {
        id,
        line_no: 1,
        kind: 'credit_sale',
        amount_ore: 3160,
        occurred_at: when,
        reference_kind: 'sale_line',
        reference_id: legacy,
        sale_price_ore: 5000,
        commission_ore: 1840,
      },
    ])
  head.from.mockReturnValueOnce(head.query).mockReturnValueOnce(lines.query)
  const result = await readStatement(head as unknown as SupabaseClient, id, id)
  expect(result?.lines[0].reference_id).toBe(legacy)
  expect(result?.statement.closing_ore).toBe(3160)
})
it('still rejects malformed references and failed authenticated reads', async () => {
  const malformed = clientFor([{ ...ledger, reference_id: 'not-an-id' }])
  await expect(
    readSellerLedger(malformed as unknown as SupabaseClient, id, id),
  ).rejects.toThrow()
  const denied = clientFor([])
  denied.rpc.mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } })
  await expect(
    readSellerLedger(denied as unknown as SupabaseClient, id, id),
  ).rejects.toThrow('Unable to read seller ledger')
})
