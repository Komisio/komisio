import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/platform/context', () => ({ platformContext: mocks.context }))
import { POST } from '../../app/api/intake/requests/route'
import { externalOfferOre } from '../../lib/platform/external-offer-amount'
import { dictionary } from '../../lib/i18n'
import { buildNavigation } from '../../lib/platform/navigation'
const id = (n: number) =>
  `f7300000-0000-4000-8000-${String(n).padStart(12, '0')}`
const input = {
  action: 'offer',
  tenantId: id(1),
  commandId: id(2),
  requestId: id(3),
  previousOfferId: null,
  sellerAmountOre: '40000',
  expectedSalePriceOre: '100000',
  agreementVersionId: id(4),
}
const request = (
  body: unknown = input,
  origin = 'https://portal.example.test',
) =>
  new Request(`${origin}/api/intake/requests`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://portal.example.test')
  vi.stubEnv('KOMISIO_INTAKE_ENABLED', 'true')
  vi.stubEnv('KOMISIO_MOBILE_API_ENABLED', 'true')
  mocks.context.mockResolvedValue({
    active: { id: id(1) },
    mfaRequired: false,
    client: { rpc: mocks.rpc },
  })
  mocks.rpc.mockResolvedValue({ data: id(2), error: null })
})
it('requires same-origin staff context, assurance and the selected tenant', async () => {
  expect(
    (await POST(request(input, 'https://foreign.example.test'))).status,
  ).toBe(403)
  expect((await POST(request({ ...input, tenantId: id(5) }))).status).toBe(409)
  mocks.context.mockResolvedValue({ mfaRequired: true })
  expect((await POST(request())).status).toBe(401)
  expect(mocks.rpc).not.toHaveBeenCalled()
})
it('sends exact integer amounts and immutable previous/terms identifiers through the engine', async () => {
  const response = await POST(request())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ id: id(2) })
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'issue_external_item_offer',
    {
      p_tenant: id(1),
      p_id: id(2),
      p_request: id(3),
      p_previous: null,
      p_amount_ore: '40000',
      p_sale_price_ore: '100000',
      p_agreement: id(4),
    },
  )
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})
it('fails closed on an unconfirmed result, unknown fields and live-offer decline', async () => {
  expect((await POST(request({ ...input, ownerId: id(7) }))).status).toBe(400)
  mocks.rpc.mockResolvedValue({ data: id(9), error: null })
  expect((await POST(request())).status).toBe(503)
  mocks.rpc.mockResolvedValue({
    data: null,
    error: { message: 'OFFER_ACTIVE' },
  })
  expect(
    (
      await POST(
        request({
          action: 'decline',
          commandId: id(2),
          tenantId: id(1),
          requestId: id(3),
          note: '',
        }),
      )
    ).status,
  ).toBe(409)
})
it('parses decimal input without floating-point rounding or silent truncation', () => {
  expect(externalOfferOre(' 400,01 ')).toBe('40001')
  expect(externalOfferOre('0.01')).toBe('1')
  expect(externalOfferOre('999999999.99')).toBe('99999999999')
  for (const value of ['0', '-1', '1e3', '1.234', '1000000000', '1,2,3'])
    expect(externalOfferOre(value)).toBeNull()
})
it('keeps ordinary store navigation unchanged and adds requests only for the central recipient', () => {
  const paths = (centralOffers?: boolean) =>
    buildNavigation(dictionary('sv'), {
      intakeEnabled: true,
      host: false,
      centralOffers,
    }).flatMap((g) => g.links.map((l) => l.path))
  expect(paths()).not.toContain('/intake/requests')
  expect(paths(true)).toContain('/intake/requests')
  expect(paths(true).filter((p) => p !== '/intake/requests')).toEqual(paths())
})
