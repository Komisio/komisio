import Link from 'next/link'
import { cookies } from 'next/headers'
import { dictionary } from '@/lib/i18n'
export default async function NotFound() {
  const d = dictionary((await cookies()).get('komisio-locale')?.value)
  return (
    <main className="onboarding">
      <h1>{d.notFound}</h1>
      <Link href="/" className="btn btn-secondary">
        {d.back}
      </Link>
    </main>
  )
}
