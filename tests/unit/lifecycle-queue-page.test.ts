import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readLifecycleQueuePage } from '../../lib/engine/lifecycle'

const tenant = '10000000-0000-4000-8000-000000000001'
const item = '20000000-0000-4000-8000-000000000001'

const row = {
  item_id: item,
  title: 'Blue lamp',
  seller_id: '30000000-0000-4000-8000-000000000001',
  ownership: 'consignment',
  stage: 'markdown_due',
  accepted_at: '2026-09-01T10:00:00+00:00',
  period_end: '2026-10-13T10:00:00+00:00',
  current_price_ore: '25000',
  due_step: 1,
  due_percent: '10',
  end_of_period_action: 'charity',
}

function client(answer: unknown) {
  const rpc = vi.fn(async () => answer)
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

describe('readLifecycleQueuePage', () => {
  it('passes validated arguments and parses the twenty-row page shape', async () => {
    const { client: c, rpc } = client({
      data: { rows: [row], total: 41, dueCount: 3, offset: 20, limit: 20 },
      error: null,
    })
    const page = await readLifecycleQueuePage(c, tenant, {
      query: '  Blue LAMP ',
      stage: 'markdown_due',
      offset: 20,
    })
    expect(rpc).toHaveBeenCalledWith('lifecycle_queue_page', {
      p_tenant: tenant,
      p_query: 'Blue LAMP',
      p_stage: 'markdown_due',
      p_offset: 20,
    })
    expect(page).toEqual({
      rows: [{ ...row, current_price_ore: 25000, due_percent: '10' }],
      total: 41,
      dueCount: 3,
      offset: 20,
      limit: 20,
    })
  })
  it('defaults to an empty query, no stage and offset zero', async () => {
    const { client: c, rpc } = client({
      data: { rows: [], total: 0, dueCount: 0, offset: 0, limit: 20 },
      error: null,
    })
    await readLifecycleQueuePage(c, tenant)
    expect(rpc).toHaveBeenCalledWith('lifecycle_queue_page', {
      p_tenant: tenant,
      p_query: '',
      p_stage: null,
      p_offset: 0,
    })
  })
  it('returns null only when the function is not deployed', async () => {
    const { client: c } = client({ data: null, error: { code: 'PGRST202' } })
    expect(await readLifecycleQueuePage(c, tenant)).toBeNull()
  })
  it('propagates any other error', async () => {
    const { client: c } = client({
      data: null,
      error: { code: '42501', message: 'FORBIDDEN' },
    })
    await expect(readLifecycleQueuePage(c, tenant)).rejects.toThrow(
      'Unable to read lifecycle queue',
    )
  })
  it.each([
    [{ query: 'x'.repeat(121) }],
    [{ stage: 'bogus' }],
    [{ offset: -1 }],
    [{ offset: 1.5 }],
    [{ offset: 2147483648 }],
  ])('rejects %j before calling the database', async (options) => {
    const { client: c, rpc } = client({ data: null, error: null })
    await expect(
      readLifecycleQueuePage(c, tenant, options as never),
    ).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects a malformed tenant and a page that is not twenty rows', async () => {
    const { client: c, rpc } = client({
      data: { rows: [], total: 0, dueCount: 0, offset: 0, limit: 25 },
      error: null,
    })
    await expect(readLifecycleQueuePage(c, 'not-a-tenant')).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
    await expect(readLifecycleQueuePage(c, tenant)).rejects.toThrow()
  })
})
