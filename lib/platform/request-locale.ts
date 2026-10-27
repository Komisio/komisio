import { cookies } from 'next/headers'
import { resolveLocale } from '@/lib/i18n'

/** Entry hints never become an explicit browser or profile preference. */
export async function requestLocale(profileLocale?: string | null) {
  const jar = await cookies()
  return resolveLocale(
    jar.get('komisio-locale')?.value,
    profileLocale,
    jar.get('komisio-entry-locale')?.value,
  )
}
