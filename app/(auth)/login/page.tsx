import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { resolveLocale } from '@/lib/i18n'
import { registrationStoreForNext } from '@/lib/platform/registration-store'
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
      registrationStoreName={await registrationStoreForNext(params.next)}
      callbackError={!!params.error}
      initialLocale={resolveLocale(
        (await cookies()).get('komisio-locale')?.value,
      )}
    />
  )
}

export const generateMetadata = () => publicPageMetadata((d) => d.login)
