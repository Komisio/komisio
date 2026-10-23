import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveSellerEmailLocale } from '../../lib/communications/locale'
import { emptyStoreProfile } from '../../lib/engine/store-profile'
import { defaultStorePolicy } from '../../lib/engine/store-policy'
import type { Locale } from '../../lib/i18n'

const tenant = 'f0000000-0000-4000-8000-000000006111'
function client(store?: Locale, fallback?: Locale, error?: string) {
  const rpc = vi.fn(async (name: string) => ({
    error: name === error ? { message: 'unavailable' } : null,
    data:
      name === 'current_store_profile'
        ? {
            id: null,
            version: 0,
            profile: store ? emptyStoreProfile(store) : null,
            publishedAt: null,
          }
        : {
            id: null,
            version: 0,
            policy: {
              ...defaultStorePolicy(),
              itemLanguage: 'it',
              communicationLanguage: fallback,
            },
          },
  }))
  return { value: { rpc } as unknown as SupabaseClient, rpc }
}

it.each([
  ['fi', 'no', 'dk', 'fi'],
  [undefined, 'no', 'dk', 'no'],
  ['unsupported', undefined, 'dk', 'dk'],
  [undefined, undefined, 'sv', 'sv'],
  [undefined, undefined, undefined, 'en'],
] as const)(
  'resolves seller %s / profile %s / default %s as %s',
  async (seller, profile, fallback, expected) => {
    const f = client(profile, fallback)
    expect(
      await resolveSellerEmailLocale(f.value, tenant, { language: seller }),
    ).toBe(expected)
    for (const [name, args] of f.rpc.mock.calls as unknown as [
      string,
      unknown,
    ][])
      expect(args, name).toEqual({ p_tenant: tenant })
    expect(f.rpc).toHaveBeenCalledTimes(seller === 'fi' ? 0 : profile ? 1 : 2)
  },
)

it.each(['current_store_profile', 'current_store_policy'])(
  'does not turn a failed %s read into a default-language send',
  async (read) => {
    const f = client(undefined, undefined, read)
    await expect(resolveSellerEmailLocale(f.value, tenant)).rejects.toThrow(
      'FORBIDDEN',
    )
  },
)
