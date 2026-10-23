import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/platform/context', () => ({ platformContext: mocks.context }))
vi.mock('@/lib/platform/invitation-email', () => ({
  sendInvitationEmail: mocks.send,
}))
import { POST } from '../../app/api/platform/route'
import { emptyStoreProfile } from '../../lib/engine/store-profile'
import { defaultStorePolicy } from '../../lib/engine/store-policy'
import { locales, type Locale } from '../../lib/i18n'
const tenant = '11111111-1111-4111-8111-111111111111'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})
it.each([...locales, undefined])(
  'uses explicit invitation language %s without inferring recipient language',
  async (locale) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === 'current_store_profile'
          ? {
              id: null,
              version: 0,
              publishedAt: null,
              profile: emptyStoreProfile('dk'),
            }
          : tenant,
      error: null,
    }))
    mocks.context.mockResolvedValue({
      client: { rpc },
      active: { id: tenant, role: 'owner' },
      locale: 'it',
    })
    mocks.send.mockResolvedValue('manual')
    const response = await POST(
      new Request('http://localhost:3000/api/platform', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: JSON.stringify({
          action: 'invite',
          tenantId: tenant,
          email: 'synthetic@example.test',
          role: 'staff',
          locale,
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ locale: locale ?? 'dk' }),
    )
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(
      locale
        ? ['create_invitation']
        : ['create_invitation', 'current_store_profile'],
    )
  },
)
it.each([
  [undefined, undefined, 'en'],
  [undefined, 'sv', 'sv'],
  [undefined, 'dk', 'dk'],
  ['fi', 'dk', 'fi'],
] as [Locale | undefined, Locale | undefined, Locale][])(
  'uses profile %s and store default %s as %s, never staff Italian',
  async (language, fallback, expected) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    const rpc = vi.fn(async (name: string) => ({
      data:
        name === 'current_store_profile'
          ? {
              id: null,
              version: 0,
              publishedAt: null,
              profile: language ? emptyStoreProfile(language) : null,
            }
          : name === 'current_store_policy'
            ? {
                id: null,
                version: 0,
                policy: {
                  ...defaultStorePolicy(),
                  communicationLanguage: fallback,
                },
              }
            : tenant,
      error: null,
    }))
    mocks.context.mockResolvedValue({
      client: { rpc },
      active: { id: tenant, role: 'owner' },
      locale: 'it',
    })
    mocks.send.mockResolvedValue('manual')
    const response = await POST(
      new Request('http://localhost:3000/api/platform', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
        body: JSON.stringify({
          action: 'invite',
          tenantId: tenant,
          email: 'synthetic@example.test',
          role: 'staff',
        }),
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ locale: expected }),
    )
  },
)
