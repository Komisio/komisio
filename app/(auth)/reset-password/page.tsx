import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
export default async function ResetPassword() {
  return (
    <AuthForm
      mode="reset"
      initialLocale={
        (await cookies()).get('komisio-locale')?.value === 'en' ? 'en' : 'sv'
      }
    />
  )
}
