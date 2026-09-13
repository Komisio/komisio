import { expect, it } from 'vitest'
import {
  storePolicyBody,
  defaultStorePolicy,
} from '../../lib/engine/store-policy'
import {
  receptionAIConfig,
  resolveReceptionAssistance,
} from '../../lib/assistance/reception-config'
import type { SupabaseClient } from '@supabase/supabase-js'

const tenant = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const env = {
  KOMISIO_RECEPTION_AI_PROVIDER: 'openai',
  KOMISIO_RECEPTION_AI_KEY: 'fixture-key-never-real',
  KOMISIO_RECEPTION_AI_MODEL: 'fixture-model',
}

it('accepts assistanceEnabled as an optional boolean policy key', () => {
  expect(
    storePolicyBody.parse({ ...defaultStorePolicy(), assistanceEnabled: true })
      .assistanceEnabled,
  ).toBe(true)
  expect('assistanceEnabled' in defaultStorePolicy()).toBe(false)
  for (const value of ['yes', 1, null])
    expect(
      storePolicyBody.safeParse({
        ...defaultStorePolicy(),
        assistanceEnabled: value,
      }).success,
    ).toBe(false)
})
it('enables assistance from the policy without an environment allowlist', () => {
  expect(receptionAIConfig(tenant, env, { assistanceEnabled: true })).toEqual({
    key: env.KOMISIO_RECEPTION_AI_KEY,
    model: env.KOMISIO_RECEPTION_AI_MODEL,
  })
  expect(receptionAIConfig(tenant, env, { assistanceEnabled: false })).toBe(
    null,
  )
  expect(receptionAIConfig(tenant, env, {})).toBe(null)
  expect(receptionAIConfig(tenant, env, null)).toBe(null)
})
it('keeps the server-side kill switch above the policy', () => {
  expect(
    receptionAIConfig(
      tenant,
      { ...env, KOMISIO_RECEPTION_AI_PROVIDER: undefined },
      { assistanceEnabled: true },
    ),
  ).toBe(null)
  expect(
    receptionAIConfig(
      tenant,
      { ...env, KOMISIO_RECEPTION_AI_KEY: '' },
      { assistanceEnabled: true },
    ),
  ).toBe(null)
})
it('resolves enablement from the policy read through the caller client', async () => {
  const client = (enabled?: boolean) =>
    ({
      rpc: async () => ({
        data: {
          id: null,
          version: 0,
          policy: { ...defaultStorePolicy(), assistanceEnabled: enabled },
        },
        error: null,
      }),
    }) as unknown as SupabaseClient
  expect(await resolveReceptionAssistance(client(true), tenant, env)).toEqual({
    key: env.KOMISIO_RECEPTION_AI_KEY,
    model: env.KOMISIO_RECEPTION_AI_MODEL,
  })
  expect(await resolveReceptionAssistance(client(), tenant, env)).toBe(null)
  // Kill switch first: no provider means no policy read at all.
  const untouched = {
    rpc: () => {
      throw new Error('should not read')
    },
  } as unknown as SupabaseClient
  expect(await resolveReceptionAssistance(untouched, tenant, {})).toBe(null)
})
it('keeps the pilot allowlist as a fallback and rejects a malformed one', () => {
  const withList = { ...env, KOMISIO_RECEPTION_AI_TENANTS: other }
  expect(receptionAIConfig(other, withList, null)).not.toBe(null)
  expect(receptionAIConfig(tenant, withList, null)).toBe(null)
  expect(
    receptionAIConfig(
      tenant,
      { ...env, KOMISIO_RECEPTION_AI_TENANTS: '*' },
      { assistanceEnabled: true },
    ),
  ).toBe(null)
})
