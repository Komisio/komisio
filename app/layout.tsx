import { requestLocale } from '@/lib/platform/request-locale'
import type { Metadata } from 'next'
import './globals.css'
import { dictionary, intlLocale } from '@/lib/i18n'
import { WorkActivityProvider } from '@/components/platform/work-activity'
import { LoadingMessageProvider } from '@/components/platform/loading-message'
import { LocaleProvider } from '@/components/platform/locale-provider'
export const metadata: Metadata = {
  title: { default: 'Komisio', template: '%s · Komisio' },
  description: 'Your second-hand store, together.',
}
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await requestLocale()
  return (
    <html lang={intlLocale(locale)}>
      <body>
        <LocaleProvider locale={locale}>
          <WorkActivityProvider message={dictionary(locale).working}>
            <LoadingMessageProvider message={dictionary(locale).loading}>
              {children}
            </LoadingMessageProvider>
          </WorkActivityProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
