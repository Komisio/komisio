import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { dictionary, resolveLocale, type Dictionary } from '@/lib/i18n'
import { renderPlatformContext } from './context'

type Title = (d: Dictionary) => string

/** Static page labels only: names, amounts and private references stay out of tabs. */
export async function platformPageMetadata(
  title: Title,
  extra: Metadata = {},
): Promise<Metadata> {
  const ctx = await renderPlatformContext()
  const locale =
    ctx?.locale ?? resolveLocale((await cookies()).get('komisio-locale')?.value)
  return { ...extra, title: title(dictionary(locale)) }
}

/** Authentication forms use the browser language before a profile is available. */
export async function publicPageMetadata(title: Title): Promise<Metadata> {
  const locale = resolveLocale((await cookies()).get('komisio-locale')?.value)
  return { title: title(dictionary(locale)) }
}
