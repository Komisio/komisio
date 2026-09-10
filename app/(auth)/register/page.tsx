import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  return (
    <AuthForm
      mode="register"
      next={(await searchParams).next}
      initialLocale={
        (await cookies()).get('komisio-locale')?.value === 'en' ? 'en' : 'sv'
      }
    />
  )
}
