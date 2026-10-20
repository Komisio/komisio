import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { platformContext } from '../../lib/platform/context'
import { POST } from '../../app/api/help/feedback/route'
import { supportRoutes } from '../../lib/help/support-routes'
vi.mock('../../lib/platform/context', () => ({ platformContext: vi.fn() }))
const id = 'd5320000-0000-4000-8000-000000000001'
const rpc = vi.fn()
const input = {
  tenantId: id,
  slug: 'labels',
  locale: 'sv',
  page: '/intake/items/private-id?email=private@example.test#private',
  helpful: true,
  comment: '  Useful  ',
}
const context = (role = 'owner', mfaRequired = false, tenant = id) => {
  vi.mocked(platformContext).mockResolvedValue({
    client: { rpc },
    mfaRequired,
    active: { id: tenant, role },
  } as unknown as NonNullable<Awaited<ReturnType<typeof platformContext>>>)
}
const request = (changes = {}, origin = 'https://app.example.test') =>
  new Request('https://app.example.test/api/help/feedback', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...changes }),
  })
beforeEach(() => {
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.test')
  rpc.mockResolvedValue({ error: null })
  context()
})
afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})
describe('help feedback boundary', () => {
  it.each(['owner', 'admin', 'staff', 'readonly'])(
    'accepts %s and removes identifiers before RPC',
    async (role) => {
      context(role)
      expect((await POST(request())).status).toBe(200)
      expect(rpc).toHaveBeenCalledExactlyOnceWith('submit_help_feedback', {
        p_tenant: id,
        p_slug: 'labels',
        p_locale: 'sv',
        p_page: '/intake/items/[id]',
        p_helpful: true,
        p_comment: 'Useful',
      })
    },
  )
  it.each(['device', 'automation'])('refuses %s', async (role) => {
    context(role)
    expect((await POST(request())).status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('rejects cross-origin, changed store, missing session and incomplete MFA', async () => {
    expect((await POST(request({}, 'https://other.test'))).status).toBe(403)
    expect(platformContext).not.toHaveBeenCalled()
    context('owner', false, 'd5320000-0000-4000-8000-000000000002')
    expect((await POST(request())).status).toBe(409)
    context('owner', true)
    expect((await POST(request())).status).toBe(401)
    vi.mocked(platformContext).mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([
    { slug: 'constructor' },
    { locale: 'xx' },
    { comment: 'x'.repeat(1001) },
    { helpful: null },
    { extra: true },
  ])('validates input %j', async (changes) => {
    expect((await POST(request(changes))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('returns a bounded localized error code, never raw database text', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'RATE_LIMITED' } })
    const limited = await POST(request())
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({ error: 'RATE_LIMITED' })
    rpc.mockResolvedValueOnce({ error: { message: 'secret database detail' } })
    expect(await (await POST(request())).json()).toEqual({
      error: 'REQUEST_FAILED',
    })
  })
  it('keeps database route privacy validation aligned with support route templates', () => {
    const sql = readFileSync(
      'supabase/migrations/20261020150000_help_feedback.sql',
      'utf8',
    )
    for (const route of supportRoutes) expect(sql).toContain(`'${route}'`)
  })
})
