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
it('passes explicit USD through the platform boundary and engine independently of locale', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: 'tenant', error: null })
  const command = commandSchema.parse({
    action: 'create',
    ...input,
    currency: 'USD',
  })
  await createStore({ rpc } as unknown as SupabaseClient, {
    ...command,
    locale: input.locale,
  })
  expect(rpc).toHaveBeenCalledWith('create_tenant_with_currency', {
    p_name: input.name,
    p_slug: input.slug,
    p_request_id: input.requestId,
    p_currency: 'USD',
  })
})
it('keeps the existing creation contract for clients without currency', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: 'tenant', error: null })
  await createStore({ rpc } as unknown as SupabaseClient, input)
  expect(rpc).toHaveBeenCalledWith('create_tenant_with_locale', {
    p_name: input.name,
    p_slug: input.slug,
    p_request_id: input.requestId,
    p_locale: 'sv',
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
