import { cookies } from 'next/headers'
import { Brand } from '@/components/platform/brand'
import { SellerActivation } from '@/components/auth/seller-activation'
import { isLocale, resolveLocale } from '@/lib/i18n'
import { publicPageMetadata } from '@/lib/platform/page-metadata'

// GET only presents a confirmation. Mail scanners must not consume the token.
export default async function Activate({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; locale?: string }>
}) {
  const query = await searchParams
  const tokenHash =
    typeof query.token_hash === 'string' &&
    /^[a-f0-9]{56,64}$/.test(query.token_hash)
      ? query.token_hash
      : ''
  const locale = isLocale(query.locale)
    ? query.locale
    : resolveLocale((await cookies()).get('komisio-locale')?.value)
  return (
    <main className="onboarding">
      <Brand />
      <SellerActivation tokenHash={tokenHash} locale={locale} />
    </main>
  )
}
export const generateMetadata = () =>
  publicPageMetadata((d) => d.sellerActivation.title)
