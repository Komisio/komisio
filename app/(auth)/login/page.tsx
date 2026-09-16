import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { resolveLocale } from '@/lib/i18n'
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  return (
    <AuthForm
      mode="login"
      next={params.next}
      callbackError={!!params.error}
      initialLocale={resolveLocale(
        (await cookies()).get('komisio-locale')?.value,
      )}
    />
  )
}
