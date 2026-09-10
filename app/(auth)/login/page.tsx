import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
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
      initialLocale={
        (await cookies()).get('komisio-locale')?.value === 'en' ? 'en' : 'sv'
      }
    />
  )
}
