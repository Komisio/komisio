import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
import { resolveLocale } from '@/lib/i18n'
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
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
