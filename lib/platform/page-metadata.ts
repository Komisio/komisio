import { requestLocale } from '@/lib/platform/request-locale'
import type { Metadata } from 'next'
import { dictionary, type Dictionary } from '@/lib/i18n'
import { renderPlatformContext } from './context'

type Title = (d: Dictionary, locale: string) => string

/** Static page labels only: names, amounts and private references stay out of tabs. */
export async function platformPageMetadata(
  title: Title,
  extra: Metadata = {},
): Promise<Metadata> {
  const ctx = await renderPlatformContext()
  const locale = ctx?.locale ?? (await requestLocale())
  return { ...extra, title: title(dictionary(locale), locale) }
}

/** Authentication forms use the browser language before a profile is available. */
export async function publicPageMetadata(title: Title): Promise<Metadata> {
  const locale = await requestLocale()
  return { title: title(dictionary(locale), locale) }
}
