import type { Dictionary } from '@/lib/i18n'

/** Explain a rejected password change without exposing raw Auth messages. */
export function passwordUpdateError(
  error: unknown,
  d: Pick<Dictionary, 'passwordMustDiffer' | 'authError'>,
): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'same_password'
    ? d.passwordMustDiffer
    : d.authError
}
