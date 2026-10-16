import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStore } from '../../lib/engine/store-creation'
import { commandSchema } from '../../lib/platform/validation'

const input = {
  name: 'Synthetic',
  slug: 'synthetic',
  requestId: '10000000-0000-4000-8000-000000000001',
  locale: 'sv',
}
const tenant = '10000000-0000-4000-8000-000000000002'
const created = { data: { tenant_id: tenant, created: true }, error: null }
it('passes explicit USD through the platform boundary and engine independently of locale', async () => {
  const rpc = vi.fn().mockResolvedValue(created)
  const command = commandSchema.parse({
    action: 'create',
    ...input,
    currency: 'USD',
  })
  await createStore({ rpc } as unknown as SupabaseClient, {
    ...command,
    locale: input.locale,
  })
  expect(rpc).toHaveBeenCalledWith('create_tenant_with_result', {
    p_name: input.name,
    p_slug: input.slug,
    p_request_id: input.requestId,
    p_currency: 'USD',
    p_locale: 'sv',
  })
})
it('keeps the existing creation contract for clients without currency', async () => {
  const rpc = vi.fn().mockResolvedValue(created)
  expect(
    await createStore({ rpc } as unknown as SupabaseClient, input),
  ).toEqual({ data: tenant, error: null, created: true })
  expect(rpc).toHaveBeenCalledWith('create_tenant_with_result', {
    p_name: input.name,
    p_slug: input.slug,
    p_request_id: input.requestId,
    p_locale: 'sv',
    p_currency: null,
  })
})
it.each(['JPY', 'GBP', 'usd', ''])(
  'rejects unsupported or malformed currency %s before database calls',
  async (currency) => {
    const rpc = vi.fn()
    await expect(
      createStore({ rpc } as unknown as SupabaseClient, { ...input, currency }),
    ).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
    expect(
      commandSchema.safeParse({ action: 'create', ...input, currency }).success,
    ).toBe(false)
  },
)
