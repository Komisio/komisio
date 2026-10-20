import { HelpSupportProvider } from '@/components/help/contact-support'
import { HelpContentProvider } from '@/components/help/content-provider'
import { helpCatalog } from '@/lib/help/content'
import { supportConfig, supportVersion } from '@/lib/help/support'
import { version } from '../../package.json'
import { LoadingMessageProvider } from '@/components/platform/loading-message'
import { NavigationWarningProvider } from '@/components/platform/navigation-warning'
import { isSellerOnly, requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { Shell } from '@/components/platform/shell'
import { Brand } from '@/components/platform/brand'
import { LanguagePicker } from '@/components/platform/language-picker'
import { SignOut } from '@/components/platform/sign-out'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
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
    const sellerOnly = await isSellerOnly(ctx)
    return (
      <LoadingMessageProvider message={d.loading}>
        <NavigationWarningProvider>
          <main className="onboarding" lang={intlLocale(ctx.locale)}>
            <Brand href={sellerOnly ? '/seller' : '/'} />
            <LanguagePicker locale={ctx.locale} label={d.language} />
            {children}
            <div className="row">
              <Link
                href={sellerOnly ? '/seller' : '/onboarding'}
                className="text-link"
              >
                {sellerOnly ? d.sellerPortal.title : d.createTenant}
              </Link>
              <SignOut d={d} next={sellerOnly ? '/seller' : undefined} />
            </div>
          </main>
        </NavigationWarningProvider>
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
      <NavigationWarningProvider>
        <HelpSupportProvider
          value={{
            ...supportConfig(process.env),
            storeName: ctx.active.name,
            tenantId: ctx.active.id,
            locale: ctx.locale,
            version: supportVersion(version, process.env.VERCEL_GIT_COMMIT_SHA),
          }}
        >
          <HelpContentProvider
            value={{
              tenantId: ctx.active.id,
              locale: ctx.locale,
              articles:
                process.env.KOMISIO_INTAKE_ENABLED === 'true'
                  ? helpCatalog(ctx.locale)
                  : {},
            }}
          >
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
          </HelpContentProvider>
        </HelpSupportProvider>
      </NavigationWarningProvider>
    </LoadingMessageProvider>
  )
}
