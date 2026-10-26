import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  summary: vi.fn(),
  render: vi.fn(),
}))
vi.mock('../../lib/platform/context', () => ({
  platformContext: mocks.context,
}))
vi.mock('../../lib/engine/sale-summary', () => ({
  readSaleSummary: mocks.summary,
}))
vi.mock('../../lib/documents/sale-summary-pdf', () => ({
  renderSaleSummaryPdf: mocks.render,
  saleSummaryPdfResponse: () => new Response('PDF'),
}))
import { GET } from '../../app/api/sales/summary/route'
const tenant = '30300000-0000-4000-8000-000000000001'
const sale = '30300000-0000-4000-8000-000000000002'
const request = () =>
  new Request(
    `http://localhost/api/sales/summary?tenant=${tenant}&sale=${sale}`,
  )
const context = () => ({
  active: { id: tenant, name: 'TEST', role: 'owner' },
  user: { email_confirmed_at: '2026-01-01', app_metadata: {} },
  mfaRequired: false,
  client: {},
  locale: 'sv',
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  mocks.context.mockResolvedValue(context())
  mocks.summary.mockResolvedValue({ id: sale })
  mocks.render.mockResolvedValue(new Uint8Array())
})
afterEach(() => vi.unstubAllEnvs())
it.each(['owner', 'admin', 'staff', 'readonly'])(
  'allows the existing %s read role',
  async (role) => {
    const ctx = context()
    ctx.active.role = role
    mocks.context.mockResolvedValue(ctx)
    expect((await GET(request())).status).toBe(200)
  },
)
it.each([
  ['anonymous', null, 401],
  ['MFA', { ...context(), mfaRequired: true }, 401],
  [
    'unverified',
    { ...context(), user: { email_confirmed_at: null, app_metadata: {} } },
    401,
  ],
  [
    'password recovery',
    {
      ...context(),
      user: {
        email_confirmed_at: 'date',
        app_metadata: { komisio_password_recovery_pending: true },
      },
    },
    401,
  ],
  ['seller only', { ...context(), active: null }, 403],
  ['other store', { ...context(), active: { id: sale, role: 'owner' } }, 409],
])('blocks %s before reading sale facts', async (_case, ctx, status) => {
  mocks.context.mockResolvedValue(ctx)
  expect((await GET(request())).status).toBe(status)
  expect(mocks.summary).not.toHaveBeenCalled()
})
it('returns a private not-found for an absent sale', async () => {
  mocks.summary.mockResolvedValue(null)
  const response = await GET(request())
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
