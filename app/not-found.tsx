import Link from 'next/link'
import { dictionary } from '@/lib/i18n'
export default function NotFound() {
  const d = dictionary()
  return (
    <main className="onboarding">
      <h1>{d.notFound}</h1>
      <Link href="/">{d.back}</Link>
    </main>
  )
}
