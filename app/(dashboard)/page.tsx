import Link from 'next/link'
import { Check, ArrowRight, Users, Sprout, CircleHelp } from 'lucide-react'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { guideCopy } from '@/lib/guide-copy'
import { can } from '@/lib/platform/permissions'
import { Button } from '@/components/ui/button'
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
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>
          {d.hello}
          {ctx.profile?.display_name ? `, ${ctx.profile.display_name}` : '.'}
        </h1>
        <p>{d.homeIntro}</p>
      </div>
      <section className="card">
        <h2>{guideCopy(ctx.locale).title}</h2>
        <p>{guideCopy(ctx.locale).intro}</p>
        <Link href="/guide" className="text-link">
          {guideCopy(ctx.locale).start} →
        </Link>
      </section>
      {overview && (
        <section className="card" aria-label={o.heading}>
          <h2>{o.heading}</h2>
          <div
            className="stats-strip"
            style={{ marginTop: 8, borderTop: 0, padding: 0, flexWrap: 'wrap' }}
          >
            <div className="stat">
              <small>{o.todaySales}</small>
              <strong>
                {overview.today ? overview.today.salesCount : '–'}
              </strong>
            </div>
            <div className="stat">
              <small>{o.todayGross}</small>
              <strong>
                {overview.today
                  ? money(overview.today.grossOre, overview.today.currency)
                  : '–'}
              </strong>
            </div>
            <div className="stat">
              <small>{o.openProposals}</small>
              <strong>{overview.openProposals ?? '–'}</strong>
            </div>
            <div className="stat">
              <small>{o.attentionDays}</small>
              <strong>{overview.attentionDays ?? '–'}</strong>
            </div>
            <div className="stat">
              <small>{o.openPayouts}</small>
              <strong>
                {overview.openPayouts
                  ? `${overview.openPayouts.count} · ${money(overview.openPayouts.amountOre, overview.today?.currency ?? 'SEK')}`
                  : '–'}
              </strong>
            </div>
            <div className="stat">
              <small>{o.owed}</small>
              <strong>
                {overview.owedOre !== null
                  ? money(overview.owedOre, overview.today?.currency ?? 'SEK')
                  : '–'}
              </strong>
            </div>
          </div>
          <p className="row wrap" style={{ marginTop: 14 }}>
            <Link className="text-link" href="/intake/operations">
              {o.openQueue}
            </Link>
            <Link className="text-link" href="/intake/accounting">
              {o.openReconciliation}
            </Link>
            <Link className="text-link" href="/intake/payouts">
              {o.openPayoutsPage}
            </Link>
            <Link className="text-link" href="/intake/economy">
              {o.openEconomy}
            </Link>
          </p>
        </section>
      )}
      <div className="home-grid">
        <section className="card">
          <div className="between">
            <div>
              <h2>{d.setupTitle}</h2>
              <p style={{ marginBottom: 0, fontSize: 13 }}>{d.setupIntro}</p>
            </div>
            <span className="badge">
              {steps.filter((s) => s.done).length} / {steps.length}
            </span>
          </div>
          <div className="steps">
            {steps.map((step) => (
              <Link
                key={step.label}
                href={step.path}
                className={`step ${step.done ? '' : 'pending'}`}
              >
                <span className="step-icon">
                  {step.done ? <Check size={14} /> : <ArrowRight size={13} />}
                </span>
                <span className="step-content">{step.label}</span>
                <small>{step.done ? d.complete : d.nextStep}</small>
              </Link>
            ))}
          </div>
        </section>
        <section className="card feature-card">
          <span className="feature-icon">
            <Users size={23} strokeWidth={1.4} />
          </span>
          <h2>{d.teamTitle}</h2>
          <p>{d.teamIntro}</p>
          <Button asChild>
            <Link href="/members">
              {can(active.role, 'members.manage')
                ? d.inviteColleague
                : d.members}
              <ArrowRight size={15} />
            </Link>
          </Button>
        </section>
      </div>
      <div className="stats-strip">
        <div className="stat">
          <small>{d.activeTenant}</small>
          <strong>{active.name}</strong>
        </div>
        <div className="stat">
          <small>{d.memberCount}</small>
          <strong>{count ?? 0}</strong>
        </div>
        <div className="stat">
          <small>{d.yourRole}</small>
          <strong>{d.roles[active.role]}</strong>
        </div>
      </div>
      <p className="footnote">
        <Sprout size={16} />
        {process.env.KOMISIO_INTAKE_ENABLED === 'true' ? (
          <Link className="text-link" href="/intake">
            {d.intake.title} – {d.intake.intro}
          </Link>
        ) : (
          d.foundationNote
        )}
      </p>
      <p className="footnote">
        <CircleHelp size={14} />
        {d.workspace}
      </p>
    </>
  )
}
