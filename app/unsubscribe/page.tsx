import { dictionary, isLocale, intlLocale } from '@/lib/i18n'
import { StoreMailUnsubscribe } from '@/components/seller/store-mail-unsubscribe'
export const metadata = {
  title: 'Komisio',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
}
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>
}) {
  const { lang } = await searchParams
  const locale = isLocale(lang) ? lang : 'en'
  return (
    <main className="onboarding" lang={intlLocale(locale)}>
      <StoreMailUnsubscribe d={dictionary(locale).storeMail} />
    </main>
  )
}
