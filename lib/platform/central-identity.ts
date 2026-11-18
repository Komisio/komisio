import type { User } from '@supabase/supabase-js'

/** Provider-owned verified claims on the same Auth ID; never contact metadata. */
export function centralIdentityEmail(user: User): string | null {
  if (user.is_anonymous) return null
  if (user.email && user.email_confirmed_at) return user.email
  for (const provider of ['apple', 'google']) {
    const email = user.identities?.find(
      (identity) =>
        identity.user_id === user.id &&
        identity.provider === provider &&
        identity.identity_data?.email_verified === true &&
        typeof identity.identity_data.email === 'string' &&
        identity.identity_data.email.trim().length > 0,
    )?.identity_data?.email
    if (typeof email === 'string') return email
  }
  return null
}
