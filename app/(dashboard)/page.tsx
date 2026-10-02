import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import {
  Check,
  ArrowRight,
  Users,
  BookOpen,
  Zap,
  PackageOpen,
  Package,
  ShoppingBag,
  ClipboardList,
  Wallet,
  CalendarCheck,
} from 'lucide-react'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { guideCopy } from '@/lib/guide-copy'
import { can } from '@/lib/platform/permissions'
import { readOnboarding } from '@/lib/engine/onboarding'
import { readOverview } from '@/lib/engine/overview'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
export default async function Home() {
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const active = ctx.active!
  const { count, error } = await ctx.client
    .from('tenant_members')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', active.id)
  if (error) throw error
  const labels = {
    account: d.stepAccount,
    store: d.stepTenant,
    profile: d.stepProfile,
    policy: d.stepPolicy,
    agreement: d.stepAgreement,
    seller: d.stepSeller,
    item: d.stepItem,
    sale: d.stepSale,
    dayClose: d.stepDayClose,
    integrations: d.stepIntegrations,
    team: d.stepTeam,
  }
  const intakeEnabled = process.env.KOMISIO_INTAKE_ENABLED === 'true'
  const overview = intakeEnabled
    ? await readOverview(ctx.client, active.id)
    : null
  const o = d.overview
  const money = (ore: number, currency: string) =>
    `${formatSignedOre(ore)} ${currency}`
  const steps = (
    intakeEnabled
      ? await readOnboarding(ctx.client, active.id, {
          profileName: !!ctx.profile?.display_name,
          members: count ?? 0,
        })
      : [
          { key: 'account' as const, done: true, path: '/account' },
          { key: 'store' as const, done: true, path: '/settings?tab=store' },
          {
            key: 'profile' as const,
            done: !!ctx.profile?.display_name,
            path: '/account',
          },
          { key: 'team' as const, done: (count ?? 0) > 1, path: '/members' },
        ]
  ).map((step) => ({ ...step, label: labels[step.key] }))
  const complete = steps.filter((step) => step.done).length
  const pending = steps.filter((step) => !step.done)
  const ui = d.dashboard
  const actions = [
    ...(active.role !== 'readonly'
      ? [
          {
            href: '/intake/quick',
            title: d.quickIntake.title,
            detail: d.intake.quickHint,
            icon: Zap,
          },
          {
            href: '/intake#bag-receiving',
            title: d.nav.receiveBag,
            detail: ui.receiptHint,
            icon: PackageOpen,
          },
        ]
      : []),
    {
      href: '/intake/items',
      title: d.items.title,
      detail: ui.itemsHint,
      icon: Package,
    },
    {
      href: '/intake/sales',
      title: d.sales.title,
      detail: ui.salesHint,
      icon: ShoppingBag,
    },
  ]
  const followUp = overview
    ? [
        {
          title: o.openProposals,
          count: overview.openProposals,
          href: '/intake/operations',
          action: o.openQueue,
          icon: ClipboardList,
        },
        {
          title: o.attentionDays,
          count: overview.attentionDays,
          href: '/intake/accounting?view=reconciliation',
          action: o.openReconciliation,
          icon: CalendarCheck,
        },
        {
          title: o.openPayouts,
          count: overview.openPayouts?.count ?? null,
          href: '/intake/payouts',
          action: o.openPayoutsPage,
          icon: Wallet,
        },
      ]
    : []
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-eyebrow">{active.name}</p>
          <h1>{d.home}</h1>
          <p>{ui.intro}</p>
        </div>
        <Link href="/guide" className="dashboard-guide-link">
          <BookOpen size={18} aria-hidden="true" />
          {guideCopy(ctx.locale).start}
        </Link>
      </header>
      {intakeEnabled && (
        <section aria-labelledby="dashboard-actions-title">
          <h2 id="dashboard-actions-title" className="dashboard-section-title">
            {ui.actions}
          </h2>
          <div className="dashboard-actions">
            {actions.map(({ href, title, detail, icon: Icon }) => (
              <Link key={href} href={href} className="dashboard-action">
                <span className="dashboard-action-top">
                  <Icon size={23} strokeWidth={1.6} aria-hidden="true" />
                  <ArrowRight size={18} aria-hidden="true" />
                </span>
                <strong>{title}</strong>
                <span>{detail}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {overview && (
        <section aria-labelledby="dashboard-today-title">
          <div className="dashboard-section-heading">
            <h2 id="dashboard-today-title">{ui.snapshot}</h2>
            <Link href="/intake/economy" className="text-link">
              {o.openEconomy}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <div className="dashboard-metrics">
            <div className="dashboard-metric">
              <span>{o.todayGross}</span>
              <strong>
                {overview.today
                  ? money(overview.today.grossOre, overview.today.currency)
                  : ui.unavailable}
              </strong>
            </div>
            <div className="dashboard-metric">
              <span>{o.todaySales}</span>
              <strong>{overview.today?.salesCount ?? ui.unavailable}</strong>
            </div>
            <div className="dashboard-metric">
              <span>{o.owed}</span>
              <strong>
                {overview.owedOre !== null
                  ? money(overview.owedOre, overview.today?.currency ?? 'SEK')
                  : ui.unavailable}
              </strong>
            </div>
          </div>
        </section>
      )}
      <div className="dashboard-columns">
        <div className="dashboard-work">
          {overview && (
            <section
              className="dashboard-panel"
              aria-labelledby="dashboard-followup-title"
            >
              <h2 id="dashboard-followup-title">{ui.followUp}</h2>
              <div className="dashboard-followups">
                {followUp.map(({ title, count, href, action, icon: Icon }) => (
                  <Link key={href} href={href} className="dashboard-followup">
                    <span className="dashboard-row-icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="dashboard-row-copy">
                      <strong>{title}</strong>
                      <span>{action}</span>
                      {href === '/intake/payouts' && overview.openPayouts && (
                        <small>
                          {money(
                            overview.openPayouts.amountOre,
                            overview.today?.currency ?? 'SEK',
                          )}
                        </small>
                      )}
                    </span>
                    <span
                      className={`dashboard-count ${count !== null && count > 0 ? 'dashboard-count-pending' : ''}`}
                    >
                      {count ?? ui.unavailable}
                    </span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="dashboard-team">
            <Users size={22} aria-hidden="true" />
            <div>
              <h2>{d.teamTitle}</h2>
              <p>
                {d.memberCount}: {count ?? 0} · {d.yourRole}:{' '}
                {d.roles[active.role]}
              </p>
            </div>
            <Link href="/members" className="text-link">
              {can(active.role, 'members.manage')
                ? d.inviteColleague
                : d.members}
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </section>
        </div>
        <section
          className="dashboard-panel dashboard-setup"
          aria-labelledby="dashboard-setup-title"
        >
          <div className="dashboard-section-heading">
            <h2 id="dashboard-setup-title">{d.setupTitle}</h2>
            <span className="badge">
              {complete} / {steps.length}
            </span>
          </div>
          <p>{d.setupIntro}</p>
          <progress
            value={complete}
            max={steps.length}
            aria-label={d.setupTitle}
          />
          <div className="dashboard-next-steps">
            {pending.slice(0, 3).map((step) => (
              <Link key={step.key} href={step.path}>
                <span className="dashboard-step-dot">
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
                <span>{step.label}</span>
              </Link>
            ))}
            {pending.length === 0 && (
              <p>
                <Check size={18} aria-hidden="true" /> {d.complete}
              </p>
            )}
          </div>
          <details className="dashboard-all-steps">
            <summary>{ui.allSteps}</summary>
            <div className="steps">
              {steps.map((step) => (
                <Link
                  key={step.key}
                  href={step.path}
                  className={`step ${step.done ? '' : 'pending'}`}
                >
                  <span className="step-icon">
                    {step.done ? (
                      <Check size={14} aria-hidden="true" />
                    ) : (
                      <ArrowRight size={14} aria-hidden="true" />
                    )}
                  </span>
                  <span className="step-content">{step.label}</span>
                  <small>{step.done ? d.complete : d.nextStep}</small>
                </Link>
              ))}
            </div>
          </details>
        </section>
      </div>
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.home)
