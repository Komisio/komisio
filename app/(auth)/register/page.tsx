import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { resolveLocale } from '@/lib/i18n'
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  return (
    <AuthForm
      mode="register"
      next={(await searchParams).next}
      initialLocale={resolveLocale(
        (await cookies()).get('komisio-locale')?.value,
      )}
    />
  )
}
