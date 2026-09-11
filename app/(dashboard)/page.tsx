import Link from 'next/link'
import { Check, ArrowRight, Users, Sprout, CircleHelp } from 'lucide-react'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { can } from '@/lib/platform/permissions'
import { Button } from '@/components/ui/button'
export default async function Home() {
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const active = ctx.active!
  const { count, error } = await ctx.client
    .from('tenant_members')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', active.id)
  if (error) throw error
  const steps = [
    { label: d.stepAccount, done: true, path: '/account' },
    { label: d.stepTenant, done: true, path: '/settings' },
    {
      label: d.stepProfile,
      done: !!ctx.profile?.display_name,
      path: '/account',
    },
    { label: d.stepTeam, done: (count ?? 0) > 1, path: '/members' },
  ]
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
      <div className="home-grid">
        <section className="card">
          <div className="between">
            <div>
              <h2>{d.setupTitle}</h2>
              <p style={{ marginBottom: 0, fontSize: 13 }}>{d.setupIntro}</p>
            </div>
            <span className="badge">
              {steps.filter((s) => s.done).length} / 4
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
