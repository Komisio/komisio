import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { cookies } from 'next/headers'
import { AuthForm } from '@/components/auth/auth-form'
import { resolveLocale, isLocale } from '@/lib/i18n'
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; locale?: string }>
}) {
  const query = await searchParams
  return (
    <AuthForm
      mode="register"
      next={query.next}
      initialLocale={
        isLocale(query.locale)
          ? query.locale
          : resolveLocale((await cookies()).get('komisio-locale')?.value)
      }
    />
  )
}

export const generateMetadata = () => publicPageMetadata((d) => d.register)
