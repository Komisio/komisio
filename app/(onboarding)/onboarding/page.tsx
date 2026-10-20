import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { isSellerOnly, requirePlatform } from '@/lib/platform/context'
import { redirect } from 'next/navigation'
import { dictionary, intlLocale } from '@/lib/i18n'
import Link from '@/components/platform/working-link'
import { SignOut } from '@/components/platform/sign-out'
import { Brand } from '@/components/platform/brand'
import { TenantForm, OpenTenant } from '@/components/platform/tenant-form'
import { AdsConsentControl } from '@/components/platform/ads-consent'
import { LegalLinks } from '@/components/platform/legal-links'
import { legalBaseUrl } from '@/lib/platform/legal'
export default async function Onboarding() {
  const ctx = await requirePlatform(false)
  if (await isSellerOnly(ctx)) redirect('/seller')
  const d = dictionary(ctx.locale)
  const documentBase = legalBaseUrl(process.env.KOMISIO_LEGAL_BASE_URL)
  return (
    <main className="onboarding" lang={intlLocale(ctx.locale)}>
      <Brand />
      <div className="page-heading">
        <div className="eyebrow">{d.createTenant}</div>
        <h1>{d.onboardingTitle}</h1>
        <p>{d.onboardingIntro}</p>
      </div>
      <section className="card">
        <AdsConsentControl
          d={d}
          locale={ctx.locale}
          legalBaseUrl={documentBase}
        />
        <TenantForm d={d} locale={ctx.locale} />
        <LegalLinks locale={ctx.locale} baseUrl={documentBase} d={d.legal} />
      </section>
      {ctx.tenants.length > 0 && (
        <section className="card">
          <h2>{d.existingTenants}</h2>
          <div className="tenant-list">
            {ctx.tenants.map((t) => (
              <OpenTenant key={t.id} d={d} tenant={t} />
            ))}
          </div>
        </section>
      )}
      <div className="row">
        <Link href="/account" className="text-link">
          {d.account}
        </Link>
        <SignOut d={d} />
      </div>
    </main>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.createTenant)
