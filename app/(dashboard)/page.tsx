import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { Check, ArrowRight, BookOpen, Plus, PackageOpen } from 'lucide-react'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { guideCopy } from '@/lib/guide-copy'
import { can } from '@/lib/platform/permissions'
import { readOnboarding } from '@/lib/engine/onboarding'
import { readOverview } from '@/lib/engine/overview'
import { readPendingRegistrationCount } from '@/lib/engine/seller-registration'
import { economyFormat } from '@/lib/intake/economy-format'
import {
  DashboardFollowUps,
  type DashboardFollowUp,
} from '@/components/platform/dashboard-followups'
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
  const pendingRegistrations =
    intakeEnabled && active.role !== 'readonly'
      ? await readPendingRegistrationCount(ctx.client, active.id)
      : null
  const format = economyFormat(ctx.locale)
  const money = format.money
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
  const followUp: DashboardFollowUp[] = overview
    ? [
        ...(pendingRegistrations !== null
          ? [
              {
                kind: 'registrations' as const,
                title: d.selfRegistration.queue,
                count: pendingRegistrations,
                countLabel: format.number(pendingRegistrations),
                href: '/intake/sellers/registrations',
                action: o.openQueue,
              },
            ]
          : []),
        {
          kind: 'proposals',
          title: o.openProposals,
          count: overview.openProposals,
          countLabel:
            overview.openProposals === null
              ? ui.unavailable
              : format.number(overview.openProposals),
          href: '/intake/operations',
          action: o.openQueue,
        },
        {
          kind: 'days',
          title:
            overview.attentionDays === null
              ? o.attentionDays
              : (overview.attentionDays === 1
                  ? ui.dayPending
                  : ui.daysPending
                ).replace('{count}', format.number(overview.attentionDays)),
          count: overview.attentionDays,
          countLabel:
            overview.attentionDays === null
              ? ui.unavailable
              : format.number(overview.attentionDays),
          detail: ui.thisMonth,
          href: '/intake/accounting?view=reconciliation',
          action: ui.viewDays,
        },
        {
          kind: 'payouts',
          title: o.openPayouts,
          count: overview.openPayouts?.count ?? null,
          countLabel: overview.openPayouts
            ? format.number(overview.openPayouts.count)
            : ui.unavailable,
          detail: overview.openPayouts
            ? money(
                overview.openPayouts.amountOre,
                overview.today?.currency ?? 'SEK',
              )
            : undefined,
          href: '/intake/payouts',
          action: o.openPayoutsPage,
        },
      ]
    : []
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>{d.home}</h1>
        {intakeEnabled && active.role !== 'readonly' && (
          <div className="dashboard-actions">
            <Link href="/intake/quick" className="btn primary">
              <Plus size={18} aria-hidden="true" />
              {ui.registerItems}
            </Link>
            <Link href="/intake#bag-receiving" className="btn">
              <PackageOpen size={18} aria-hidden="true" />
              {ui.receiveDropoff}
            </Link>
          </div>
        )}
      </header>
      {overview && (
        <>
          <section aria-label={ui.snapshot}>
            <dl className="dashboard-metrics">
              <div className="dashboard-metric">
                <dt>{ui.salesToday}</dt>
                <dd>
                  <span className="dashboard-metric-amount">
                    {overview.today
                      ? money(overview.today.grossOre, overview.today.currency)
                      : ui.unavailable}
                  </span>
                  <small>{ui.beforeReturns}</small>
                </dd>
              </div>
              <div className="dashboard-metric">
                <dt>{o.todaySales}</dt>
                <dd>
                  <span className="dashboard-metric-amount">
                    {overview.today
                      ? format.number(overview.today.salesCount)
                      : ui.unavailable}
                  </span>
                </dd>
              </div>
              <div className="dashboard-metric">
                <dt>{o.owed}</dt>
                <dd>
                  <span className="dashboard-metric-amount">
                    {overview.owedOre !== null
                      ? money(
                          overview.owedOre,
                          overview.today?.currency ?? 'SEK',
                        )
                      : ui.unavailable}
                  </span>
                  <small>{ui.currentTotal}</small>
                </dd>
              </div>
            </dl>
          </section>
          <DashboardFollowUps items={followUp} ui={ui} />
        </>
      )}
      <details className="dashboard-help" open={!intakeEnabled}>
        <summary>
          <BookOpen size={18} aria-hidden="true" />
          <span>{ui.introductionHelp}</span>
          {pending.length > 0 && (
            <span className="badge">
              {complete} / {steps.length}
            </span>
          )}
        </summary>
        <div className="dashboard-help-content">
          <div className="dashboard-help-links">
            <Link href="/guide">{guideCopy(ctx.locale).start}</Link>
            <Link href="/members">
              {can(active.role, 'members.manage')
                ? d.inviteColleague
                : d.members}
            </Link>
          </div>
          <section aria-labelledby="dashboard-setup-title">
            <h2 id="dashboard-setup-title">{d.setupTitle}</h2>
            <progress
              value={complete}
              max={steps.length}
              aria-label={d.setupTitle}
            />
            <div className="steps">
              {steps.map((step) => (
                <Link
                  key={step.key}
                  href={step.path}
                  className={'step ' + (step.done ? '' : 'pending')}
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
          </section>
        </div>
      </details>
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.home)
