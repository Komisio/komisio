import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { resolveLocale } from '@/lib/i18n'
export default async function ResetPassword() {
  return (
    <AuthForm
      mode="reset"
      initialLocale={resolveLocale(
        (await cookies()).get('komisio-locale')?.value,
      )}
    />
  )
}
