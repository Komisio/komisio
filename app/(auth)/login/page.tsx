import { platformContext } from '@/lib/platform/context'
import { requestLocale } from '@/lib/platform/request-locale'
import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { AuthForm } from '@/components/auth/auth-form'
import { registrationStoreForNext } from '@/lib/platform/registration-store'
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>
}) {
  const params = await searchParams
  const context = await platformContext()
  return (
    <AuthForm
      mode="login"
      next={params.next}
      registrationStoreName={await registrationStoreForNext(params.next)}
      callbackError={!!params.error}
      initialLocale={context?.locale ?? (await requestLocale())}
    />
  )
}

export const generateMetadata = () => publicPageMetadata((d) => d.login)
