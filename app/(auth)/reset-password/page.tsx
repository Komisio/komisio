import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { resolveLocale } from '@/lib/i18n'
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  return (
    <AuthForm
      mode="reset"
      next={(await searchParams).next}
      initialLocale={resolveLocale(
        (await cookies()).get('komisio-locale')?.value,
      )}
    />
  )
}

export const generateMetadata = () => publicPageMetadata((d) => d.reset)
