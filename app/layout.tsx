import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { intlLocale, resolveLocale } from '@/lib/i18n'
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
  const locale = resolveLocale((await cookies()).get('komisio-locale')?.value)
  return (
    <html lang={intlLocale(locale)}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  )
}
