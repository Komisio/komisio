import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import './globals.css'
export const metadata: Metadata = {
  title: { default: 'Komisio', template: '%s · Komisio' },
  description: 'Your second-hand store, together.',
}
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale =
    (await cookies()).get('komisio-locale')?.value === 'en' ? 'en' : 'sv'
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  )
}
