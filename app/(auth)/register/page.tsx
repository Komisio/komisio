import { requestLocale } from '@/lib/platform/request-locale'
import { publicPageMetadata } from '@/lib/platform/page-metadata'
import { AuthForm } from '@/components/auth/auth-form'
import { isLocale } from '@/lib/i18n'
import { marketingConsentEnabled } from '@/lib/platform/marketing-consent'
import { legalBaseUrl } from '@/lib/platform/legal'
import { registrationStoreForNext } from '@/lib/platform/registration-store'
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; locale?: string }>
}) {
  const query = await searchParams
  return (
    <AuthForm
      mode="register"
      legalBaseUrl={legalBaseUrl(process.env.KOMISIO_LEGAL_BASE_URL)}
      marketingConsent={marketingConsentEnabled()}
      next={query.next}
      registrationStoreName={await registrationStoreForNext(query.next)}
      initialLocale={
        isLocale(query.locale) ? query.locale : await requestLocale()
      }
    />
  )
}

export const generateMetadata = () => publicPageMetadata((d) => d.register)
