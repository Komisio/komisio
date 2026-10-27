import { requestLocale } from '@/lib/platform/request-locale'
import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { AuthForm } from '@/components/auth/auth-form'
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  return (
    <AuthForm
      mode="reset"
      next={(await searchParams).next}
      initialLocale={await requestLocale()}
    />
  )
}

export const generateMetadata = () => publicPageMetadata((d) => d.reset)
