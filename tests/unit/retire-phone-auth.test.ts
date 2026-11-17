import { describe, expect, it, vi } from 'vitest'
import { retirePhoneAuth } from '../../scripts/retire-phone-auth.mjs'

const env = {
  NODE_ENV: 'test' as const,
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  SUPABASE_PROJECT_ID: 'a'.repeat(20),
  SUPABASE_ACCESS_TOKEN: 'synthetic',
}
const current = {
  site_url: 'https://komisio-staging.vercel.app',
  external_phone_enabled: true,
  hook_send_sms_enabled: true,
  hook_send_sms_uri: 'https://komisio-staging.vercel.app/api/auth/sms',
  hook_send_sms_secrets: 'synthetic-hook-secret',
  external_apple_enabled: true,
  external_google_enabled: true,
  mailer_autoconfirm: false,
  mfa_totp_enroll_enabled: true,
  mfa_totp_verify_enabled: true,
}
describe('phone authentication retirement', () => {
  it('disables phone and transport without altering email, OAuth or MFA', async () => {
    const after = {
      ...current,
      external_phone_enabled: false,
      hook_send_sms_enabled: false,
      hook_send_sms_uri: null,
      hook_send_sms_secrets: null,
    }
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(current))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json(after))
    await retirePhoneAuth('staging', env, request)
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({
      external_phone_enabled: false,
      hook_send_sms_enabled: false,
      hook_send_sms_uri: null,
      hook_send_sms_secrets: null,
    })
  })
  it('requires the protected main operation and checks the target before mutation', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(current))
    await expect(
      retirePhoneAuth(
        'staging',
        { ...env, GITHUB_REF: 'refs/heads/feature' },
        request,
      ),
    ).rejects.toThrow('protected')
    expect(request).not.toHaveBeenCalled()
    await expect(retirePhoneAuth('production', env, request)).rejects.toThrow(
      'environment mismatch',
    )
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('refuses to report success when a different Auth setting changes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(current))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(
        Response.json({
          ...current,
          external_phone_enabled: false,
          hook_send_sms_enabled: false,
          hook_send_sms_uri: null,
          hook_send_sms_secrets: null,
          external_apple_enabled: false,
        }),
      )
    await expect(retirePhoneAuth('staging', env, request)).rejects.toThrow(
      'Unrelated',
    )
  })
  it('does not report completion when the hook signing secret remains', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(current))
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(
        Response.json({
          ...current,
          external_phone_enabled: false,
          hook_send_sms_enabled: false,
          hook_send_sms_uri: null,
        }),
      )
    await expect(retirePhoneAuth('staging', env, request)).rejects.toThrow(
      'verification failed',
    )
  })
  it('reports the provider HTTP status without exposing response data', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(current))
      .mockResolvedValueOnce(
        Response.json(
          { message: 'synthetic-sensitive-response' },
          { status: 400 },
        ),
      )
    await expect(retirePhoneAuth('staging', env, request)).rejects.toThrow(
      /^Cannot retire phone authentication \(HTTP 400\)$/,
    )
    expect(request).toHaveBeenCalledTimes(2)
  })
})
