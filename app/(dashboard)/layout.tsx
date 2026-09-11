import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { Shell } from '@/components/platform/shell'
import { Brand } from '@/components/platform/brand'
import { SignOut } from '@/components/platform/sign-out'
import Link from 'next/link'
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ctx = await requirePlatform(false)
  if (!ctx.active) {
    const d = dictionary(ctx.locale)
    return (
      <main className="onboarding">
        <Brand />
        {children}
        <div className="row">
          <Link href="/onboarding" className="text-link">
            {d.createTenant}
          </Link>
          <SignOut d={d} />
        </div>
      </main>
    )
  }
  return (
    <Shell
      intakeEnabled={process.env.KOMISIO_INTAKE_ENABLED === 'true'}
      d={dictionary(ctx.locale)}
      tenants={ctx.tenants}
      active={ctx.active!}
      email={ctx.user.email ?? ''}
      name={ctx.profile?.display_name ?? ''}
    >
      {children}
    </Shell>
  )
}
