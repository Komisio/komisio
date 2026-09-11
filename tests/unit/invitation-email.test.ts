import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sendInvitationEmail } from '../../lib/platform/invitation-email'

const input = {
  invitationId: 'd8c98b12-444c-4c48-a7ea-6918bb8a71f3',
  email: 'pilot@example.test',
  inviteUrl: 'https://staging.example.test/invite/' + 'a'.repeat(64),
  locale: 'sv' as const,
}
const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('INVITATION_EMAIL_DELIVERY', 'resend')
  vi.stubEnv('INVITATION_EMAIL_ALLOWLIST', 'pilot@example.test')
  vi.stubEnv('INVITATION_EMAIL_FROM', 'Komisio <noreply@example.test>')
  vi.stubEnv('RESEND_API_KEY', 'test-only-not-a-real-key')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it('does not send when manual delivery is configured', async () => {
  vi.stubEnv('INVITATION_EMAIL_DELIVERY', 'manual')
  expect(await sendInvitationEmail(input)).toBe('manual')
  expect(fetchMock).not.toHaveBeenCalled()
})
it('never sends outside the exact pilot allowlist, even on a matching domain', async () => {
  expect(
    await sendInvitationEmail({ ...input, email: 'someone@example.test' }),
  ).toBe('restricted')
  expect(fetchMock).not.toHaveBeenCalled()
})
it('fails closed when the allowlist is empty', async () => {
  vi.stubEnv('INVITATION_EMAIL_ALLOWLIST', '')
  expect(await sendInvitationEmail(input)).toBe('restricted')
  expect(fetchMock).not.toHaveBeenCalled()
})
it('submits one fixed invitation with an idempotency key and normalized recipient', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ id: 'provider-message-id' })),
  )
  expect(
    await sendInvitationEmail({ ...input, email: ' PILOT@example.test ' }),
  ).toBe('accepted')
  const [url, options] = fetchMock.mock.calls[0]
  expect(url).toBe('https://api.resend.com/emails')
  expect(options.headers['Idempotency-Key']).toBe(
    `komisio-invitation/${input.invitationId}`,
  )
  const body = JSON.parse(options.body)
  expect(body.to).toEqual(['pilot@example.test'])
  expect(body.text).toContain(input.inviteUrl)
  expect(body.html).toBeUndefined()
})
it.each([429, 500])(
  'preserves manual sharing when provider returns %s',
  async (status) => {
    fetchMock.mockResolvedValue(new Response('{}', { status }))
    expect(await sendInvitationEmail(input)).toBe('unconfirmed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  },
)
it('does not claim non-delivery or retry after an ambiguous timeout', async () => {
  fetchMock.mockRejectedValue(new Error('timeout'))
  expect(await sendInvitationEmail(input)).toBe('unconfirmed')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
