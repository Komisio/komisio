import { describe, expect, it } from 'vitest'
import { AuthApiError } from '@supabase/supabase-js'
import { dictionary, locales } from '../../lib/i18n'
import { passwordUpdateError } from '../../lib/platform/password-update-error'

describe('password update feedback', () => {
  it.each(locales)(
    'explains password reuse in %s without exposing the provider message',
    (locale) => {
      const d = dictionary(locale)
      const failure = new AuthApiError(
        'Provider-only details',
        422,
        'same_password',
      )
      expect(passwordUpdateError(failure, d)).toBe(d.passwordMustDiffer)
      expect(d.passwordMustDiffer).not.toBe(d.authError)
      expect(d.passwordMustDiffer).not.toContain('Provider-only details')
    },
  )

  it.each([
    null,
    undefined,
    'same_password',
    new Error('Provider-only details'),
    new AuthApiError('Provider-only details', 422, 'weak_password'),
    new AuthApiError('Provider-only details', 401, 'session_not_found'),
  ])('keeps unrelated failures generic (%s)', (failure) => {
    expect(passwordUpdateError(failure, dictionary('sv'))).toBe(
      dictionary('sv').authError,
    )
  })
})
