/**
 * Which countries may open a new store on this deployment.
 *
 * This exists for one narrow reason: drive-by registrations that never become
 * stores. It is a filter on noise, not a security control. Anyone determined
 * reaches the deployment through a VPN in seconds, and the sign-up call itself
 * goes from the browser to Supabase without passing this code at all. What it
 * does stop is the traffic that arrives by accident and leaves without using
 * anything, which is the traffic the owner actually sees.
 *
 * It is therefore deliberately narrow: only the two pages that turn a visitor
 * into a new store. Signing in, running a store and everything a store does
 * stay open from everywhere, so an owner who travels is never locked out of
 * their own shop.
 */
/**
 * The two paths that turn a visitor into a new store: the registration page
 * and the page that creates the store. A trailing slash counts as the same
 * page; nothing below them is matched, because nothing below them exists.
 */
export function signupPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/'
  return path === '/register' || path === '/onboarding'
}

export function signupBlockedCountries(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{2}$/.test(code))
}

/**
 * Whether to refuse a new store from this request's country.
 *
 * Fails open by design. An unknown country means either a deployment that is
 * not behind Vercel, a self-hosted install, or local development, and none of
 * those should lose the ability to register. An empty list blocks nothing, so
 * the feature is off until the deployment names countries.
 */
export function signupBlocked(
  list: string | undefined,
  country: string | null | undefined,
): boolean {
  const blocked = signupBlockedCountries(list)
  if (blocked.length === 0) return false
  const code = (country ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return false
  return blocked.includes(code)
}
