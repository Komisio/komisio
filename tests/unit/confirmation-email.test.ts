import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  confirmationConfig,
  confirmationCopy,
} from '../../scripts/confirmation-template.mjs'
import { configureAuthEmails } from '../../scripts/configure-auth-emails.mjs'
import { locales } from '../../lib/i18n'

const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'Komisio/komisio',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  SUPABASE_PROJECT_ID: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'test-only',
}
describe('localized confirmation emails', () => {
  it('ships the same local body and subject as the hosted configuration', () => {
    const config = confirmationConfig()
    expect(
      readFileSync('supabase/templates/confirmation.html', 'utf8').trim(),
    ).toBe(config.mailer_templates_confirmation_content)
    expect(readFileSync('supabase/config.toml', 'utf8')).toContain(
      `subject = '''${config.mailer_subjects_confirmation}'''`,
    )
    expect(Object.keys(confirmationCopy).sort()).toEqual([...locales].sort())
    expect(
      config.mailer_templates_confirmation_content.match(
        /\{\{ \.ConfirmationURL \}\}/g,
      ),
    ).toHaveLength(8)
  })
  it('requires protected main deployment context before any request', async () => {
    for (const bad of [
      { GITHUB_REF: 'refs/heads/feature' },
      { GITHUB_EVENT_NAME: 'push' },
      { GITHUB_REPOSITORY: 'other/repo' },
      { GITHUB_ACTIONS: 'false' },
      { SUPABASE_PROJECT_ID: 'invalid' },
    ]) {
      const request = vi.fn()
      await expect(
        configureAuthEmails('production', { ...env, ...bad }, request),
      ).rejects.toThrow()
      expect(request).not.toHaveBeenCalled()
    }
  })
  it('patches only confirmation content and subject and verifies both', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(Response.json(confirmationConfig()))
    await configureAuthEmails('production', env, request)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual(
      confirmationConfig(),
    )
    expect(
      Object.keys(JSON.parse(request.mock.calls[0][1].body)).sort(),
    ).toEqual([
      'mailer_subjects_confirmation',
      'mailer_templates_confirmation_content',
    ])
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('fails deployment if readback differs', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(Response.json({}))
    await expect(
      configureAuthEmails('production', env, request),
    ).rejects.toThrow('mismatch')
  })
})
