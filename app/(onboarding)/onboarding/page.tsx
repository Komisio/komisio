import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import Link from 'next/link'
import { SignOut } from '@/components/platform/sign-out'
import { Brand } from '@/components/platform/brand'
import { TenantForm, OpenTenant } from '@/components/platform/tenant-form'
export default async function Onboarding() {
  const ctx = await requirePlatform(false)
  const d = dictionary(ctx.locale)
  return (
    <main className="onboarding">
      <Brand />
      <div className="page-heading">
        <div className="eyebrow">{d.createTenant}</div>
        <h1>{d.onboardingTitle}</h1>
        <p>{d.onboardingIntro}</p>
      </div>
      <section className="card">
        <TenantForm d={d} locale={ctx.locale} />
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
