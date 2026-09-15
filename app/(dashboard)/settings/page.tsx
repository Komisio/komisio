import { readStorePolicy } from '@/lib/engine/store-policy'
import { StorePolicyForm } from '@/components/intake/store-policy-form'
import { StoreProfileForm } from '@/components/intake/store-profile-form'
import { readStoreProfile } from '@/lib/engine/store-profile'
import { PrinterForm } from '@/components/intake/printer-form'
import { readPrinters, readPrintJobs } from '@/lib/engine/printing'
import { readUsageSummary } from '@/lib/engine/usage'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { can } from '@/lib/platform/permissions'
import { TenantForm } from '@/components/platform/tenant-form'
import { PlanPanel } from '@/components/platform/plan-panel'
import { readPlanStatus } from '@/lib/engine/plans'
import { BillingActions } from '@/components/platform/billing-actions'
import { stripeConfigured } from '@/extensions/stripe/api'
import { readChainOverview } from '@/lib/engine/chains'
import { ChainPanel } from '@/components/platform/chain-panel'
import Link from 'next/link'
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const active = ctx.active!
  const policy =
    process.env.KOMISIO_INTAKE_ENABLED === 'true'
      ? await readStorePolicy(ctx.client, active.id)
      : null
  const [printers, jobs, usage, profile] =
    process.env.KOMISIO_INTAKE_ENABLED === 'true'
      ? await Promise.all([
          readPrinters(ctx.client, active.id),
          readPrintJobs(ctx.client, active.id),
          readUsageSummary(ctx.client, active.id),
          readStoreProfile(ctx.client, active.id),
        ])
      : [[], [], [], null]
  const pr = d.printing,
    us = d.usage
  const plan = await readPlanStatus(ctx.client, active.id)
  const chain = await readChainOverview(ctx.client, active.id)
  const events = can(active.role, 'audit.read')
    ? await ctx.client
        .from('access_events')
        .select('id,action,occurred_at')
        .eq('tenant_id', active.id)
        .order('occurred_at', { ascending: false })
        .limit(12)
    : { data: [], error: null }
  if (events.error) throw events.error
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.tenant}</h1>
        <p>{d.tenantIntro}</p>
        {process.env.KOMISIO_INTAKE_ENABLED === 'true' && (
          <Link className="text-link" href="/intake/agreements">
            {d.agreements.manage}
          </Link>
        )}
      </div>
      {policy && (
        <StorePolicyForm
          key={`${active.id}-${policy.id ?? 'default'}`}
          tenantId={active.id}
          current={policy}
          editable={['owner', 'admin'].includes(active.role)}
          d={d}
        />
      )}
      {profile && (
        <StoreProfileForm
          key={`${active.id}-${profile.id ?? 'none'}`}
          tenantId={active.id}
          current={profile}
          editable={['owner', 'admin'].includes(active.role)}
          locale={ctx.locale === 'sv' ? 'sv' : 'en'}
          d={d}
        />
      )}
      {usage.length > 0 && (
        <section className="card intake-form" aria-label={us.title}>
          <h2>{us.title}</h2>
          <p>
            {us.intro} {us.period}: {usage[0].period}
          </p>
          <ul>
            {usage.map((u) => (
              <li key={u.feature}>
                {us.features[u.feature]}: {u.units}
                {u.quota === null
                  ? ` · ${us.noQuota}`
                  : ` · ${us.quota} ${u.quota}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {process.env.KOMISIO_INTAKE_ENABLED === 'true' && (
        <section className="card intake-form" aria-label={pr.title}>
          <h2>{pr.title}</h2>
          <p>{pr.intro}</p>
          {printers.length === 0 && <p>{pr.none}</p>}
          {printers.map((p) => (
            <details key={p.id}>
              <summary>
                {p.name} · {p.transport === 'tcp' ? p.address : pr.usb} ·{' '}
                {p.active ? pr.activeLabel : pr.inactiveLabel}
              </summary>
              {['owner', 'admin'].includes(active.role) && (
                <PrinterForm
                  tenantId={active.id}
                  existing={p}
                  d={pr}
                  intake={d.intake}
                />
              )}
            </details>
          ))}
          {['owner', 'admin'].includes(active.role) && (
            <>
              <h3>{pr.registerHeading}</h3>
              <PrinterForm
                key={`new-${printers.length}`}
                tenantId={active.id}
                d={pr}
                intake={d.intake}
              />
            </>
          )}
          <h3>{pr.jobs}</h3>
          {jobs.length === 0 && <p>{pr.noJobs}</p>}
          {jobs.slice(0, 20).map((j) => (
            <p key={j.id}>
              {new Date(j.created_at).toLocaleString(ctx.locale)} ·{' '}
              {pr.kinds[j.label_kind]} · {j.copies} · {pr.statuses[j.status]}
              {j.error ? ` · ${j.error}` : ''}
            </p>
          ))}
          <p>
            <small>{pr.agentHint}</small>
          </p>
        </section>
      )}
      <div className="settings-grid">
        <section className="card">
          <h2>{d.tenantIdentity}</h2>
          {can(active.role, 'tenant.edit') ? (
            <TenantForm d={d} tenant={active} />
          ) : (
            <p>{active.name}</p>
          )}
          <h3>{d.chain.title}</h3>
          {active.role === 'owner' ? (
            <ChainPanel
              d={d}
              active={active}
              tenants={ctx.tenants}
              chain={chain}
            />
          ) : (
            <p>
              {chain
                ? `${chain.name} · ${d.chain.storesInChain.replace('{count}', String(chain.stores.length))}`
                : d.chain.none}
            </p>
          )}
          <PlanPanel
            status={plan}
            locale={ctx.locale}
            d={d.plans}
            actions={
              plan && plan.billing && active.role === 'owner' ? (
                <BillingActions
                  tenantId={active.id}
                  status={plan}
                  configured={stripeConfigured(process.env)}
                  outcome={
                    query.billing === 'success' || query.billing === 'cancelled'
                      ? query.billing
                      : null
                  }
                  d={d.plans}
                />
              ) : null
            }
          />
          <hr className="divider" />
          <div className="read-details">
            <label>{d.slug}</label>
            <p>{active.slug}</p>
            <label>{d.tenantId}</label>
            <p>{active.id}</p>
            <small>{d.tenantImmutable}</small>
          </div>
        </section>
        {can(active.role, 'audit.read') && (
          <section className="card">
            <h2>{d.audit}</h2>
            {events.data?.map((e) => (
              <div key={e.id} className="audit-row">
                <span>
                  {d.events[e.action as keyof typeof d.events] ?? e.action}
                </span>
                <small>
                  {new Date(e.occurred_at).toLocaleDateString(ctx.locale)}
                </small>
              </div>
            ))}
            {!events.data?.length && <p>{d.noAudit}</p>}
          </section>
        )}
      </div>
    </>
  )
}
