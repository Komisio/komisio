import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { AccountForm, PasswordForm } from '@/components/platform/account-form'
import { MfaForm } from '@/components/auth/mfa-form'
import { SignOut } from '@/components/platform/sign-out'
import Link from 'next/link'
export default async function Account() {
  const ctx = await requirePlatform(false)
  const d = dictionary(ctx.locale)
  const { data } = await ctx.client.auth.mfa.listFactors()
  return (
    <>
      <div className="page-heading">
        <h1>{d.account}</h1>
        <p>{d.accountIntro}</p>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h2>{d.profile}</h2>
          <AccountForm
            d={d}
            name={ctx.profile?.display_name ?? ''}
            email={ctx.user.email ?? ''}
            locale={ctx.locale}
          />
        </section>
        <div className="stack">
          <section className="card">
            <h2>{d.passwordChange}</h2>
            <PasswordForm d={d} />
          </section>
          <section className="card">
            <h2>{d.mfa}</h2>
            <MfaForm
              d={d}
              verified={data?.totp.some((f) => f.status === 'verified')}
              enroll
            />
          </section>
        </div>
      </div>
      {ctx.active && (
        <div className="mobile-only row" style={{ marginTop: 24 }}>
          <Link href="/onboarding" className="text-link">
            {d.newTenant}
          </Link>
          <SignOut d={d} />
        </div>
      )}
    </>
  )
}
