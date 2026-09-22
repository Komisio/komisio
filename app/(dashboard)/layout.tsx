import { LoadingMessageProvider } from '@/components/platform/loading-message'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { Shell } from '@/components/platform/shell'
import { Brand } from '@/components/platform/brand'
import { LanguagePicker } from '@/components/platform/language-picker'
import { SignOut } from '@/components/platform/sign-out'
import Link from 'next/link'
import { PlanBanner } from '@/components/platform/plan-banner'
import { isPlatformHost, readPlanStatus } from '@/lib/engine/plans'
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requirePlatform(false)
  if (!ctx.active) {
    const d = dictionary(ctx.locale)
    return (
      <LoadingMessageProvider message={d.loading}>
        <main className="onboarding">
          <Brand />
          <LanguagePicker locale={ctx.locale} label={d.language} />
          {children}
          <div className="row">
            <Link href="/onboarding" className="text-link">
              {d.createTenant}
            </Link>
            <SignOut d={d} />
          </div>
        </main>
      </LoadingMessageProvider>
    )
  }
  const d = dictionary(ctx.locale)
  const [plan, host] = await Promise.all([
    readPlanStatus(ctx.client, ctx.active.id),
    isPlatformHost(ctx.client),
  ])
  return (
    <LoadingMessageProvider message={d.loading}>
      <Shell
        intakeEnabled={process.env.KOMISIO_INTAKE_ENABLED === 'true'}
        host={host}
        d={d}
        locale={ctx.locale}
        tenants={ctx.tenants}
        active={ctx.active!}
        email={ctx.user.email ?? ''}
        name={ctx.profile?.display_name ?? ''}
      >
        <PlanBanner
          status={plan}
          isOwner={ctx.active.role === 'owner'}
          d={d.plans}
        />
        {children}
      </Shell>
    </LoadingMessageProvider>
  )
}
