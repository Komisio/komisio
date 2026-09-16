import { readStorePolicy } from '@/lib/engine/store-policy'
import { StorePolicyForm } from '@/components/intake/store-policy-form'
import { StoreProfileForm } from '@/components/intake/store-profile-form'
import { readStoreProfile } from '@/lib/engine/store-profile'
import { PrinterForm } from '@/components/intake/printer-form'
import {
  readLabelFormats,
  readLabelTemplates,
  readPrinters,
  readPrintJobs,
} from '@/lib/engine/printing'
import { LabelFormatsForm } from '@/components/intake/label-formats-form'
import { LabelTemplatesForm } from '@/components/intake/label-templates-form'
import { builtinTemplate } from '@/lib/labels/placeholders'
import { PrintDevices } from '@/components/intake/print-devices'
import {
  printAgentDownload,
  readPrintDevices,
} from '@/lib/engine/print-devices'
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
import { ConnectorsPanel } from '@/components/platform/connectors-panel'
import {
  appOrigin,
  connectorsEnabled,
  mcpPath,
  readConnectors,
} from '@/lib/engine/connectors'

const tabs = ['policy', 'profile', 'store', 'printing', 'connectors'] as const
type Tab = (typeof tabs)[number]

/**
 * Store settings in four tabs. Only the selected tab's data beyond the shared
 * reads is fetched. A Stripe return (`billing=`) lands on the store tab.
 */
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const ctx = await requirePlatform()
  const d = dictionary(ctx.locale)
  const active = ctx.active!
  const intake = process.env.KOMISIO_INTAKE_ENABLED === 'true'
  const tab: Tab = !intake
    ? 'store'
    : tabs.includes(query.tab as Tab)
      ? (query.tab as Tab)
      : query.billing
        ? 'store'
        : 'policy'
  const manages = ['owner', 'admin'].includes(active.role)
  const policy =
    intake && tab === 'policy'
      ? await readStorePolicy(ctx.client, active.id)
      : null
  const usage =
    intake && tab === 'policy'
      ? await readUsageSummary(ctx.client, active.id)
      : []
  const profile =
    intake && tab === 'profile'
      ? await readStoreProfile(ctx.client, active.id)
      : null
  const [printers, jobs, formats, devices, templates] =
    intake && tab === 'printing'
      ? await Promise.all([
          readPrinters(ctx.client, active.id),
          readPrintJobs(ctx.client, active.id),
          readLabelFormats(ctx.client, active.id),
          readPrintDevices(ctx.client, active.id),
          readLabelTemplates(ctx.client, active.id),
        ])
      : [[], [], null, null, null]
  const previewDpi = (printers.find((p) => p.active)?.dpi ?? 203) as
    203 | 300 | 600
  const plan =
    tab === 'store' || tab === 'connectors'
      ? await readPlanStatus(ctx.client, active.id)
      : null
  const connectors =
    tab === 'connectors' ? await readConnectors(ctx.client, active.id) : null
  const chain =
    tab === 'store' ? await readChainOverview(ctx.client, active.id) : null
  const events =
    tab === 'store' && can(active.role, 'audit.read')
      ? await ctx.client
          .from('access_events')
          .select('id,action,occurred_at')
          .eq('tenant_id', active.id)
          .order('occurred_at', { ascending: false })
          .limit(12)
      : { data: [], error: null }
  if (events.error) throw events.error
  const pr = d.printing,
    us = d.usage
  const visible = tabs.filter(
    (t) =>
      (intake || t === 'store') && (t !== 'connectors' || connectorsEnabled()),
  )
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{active.name}</div>
        <h1>{d.tenant}</h1>
        <p>{d.tenantIntro}</p>
        {intake && (
          <Link className="text-link" href="/intake/agreements">
            {d.agreements.manage}
          </Link>
        )}
      </div>
      {visible.length > 1 && (
        <nav className="view-tabs" aria-label={d.settingsTabsLabel}>
          {visible.map((t) => (
            <Link
              key={t}
              href={t === 'policy' ? '/settings' : `/settings?tab=${t}`}
              className={`view-tab ${tab === t ? 'active' : ''}`}
              aria-current={tab === t ? 'page' : undefined}
            >
              {d.settingsTabs[t]}
            </Link>
          ))}
        </nav>
      )}
      {tab === 'policy' && policy && (
        <StorePolicyForm
          key={`${active.id}-${policy.id ?? 'default'}`}
          tenantId={active.id}
          current={policy}
          editable={manages}
          d={d}
        />
      )}
      {tab === 'policy' && usage.length > 0 && (
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
      {tab === 'profile' && profile && (
        <StoreProfileForm
          key={`${active.id}-${profile.id ?? 'none'}`}
          tenantId={active.id}
          current={profile}
          editable={manages}
          locale={ctx.locale === 'sv' ? 'sv' : 'en'}
          d={d}
        />
      )}
      {tab === 'connectors' && connectorsEnabled() && (
        <ConnectorsPanel
          tenantId={active.id}
          connectors={connectors ?? []}
          endpoint={`${appOrigin()}${mcpPath}`}
          plus={!plan || plan.tier !== 'free'}
          locale={ctx.locale}
          d={d.connectors}
        />
      )}
      {tab === 'printing' && (
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
              {manages && (
                <PrinterForm
                  tenantId={active.id}
                  existing={p}
                  d={pr}
                  intake={d.intake}
                />
              )}
              {p.transport === 'tcp' && devices && (
                <PrintDevices
                  key={`devices-${p.id}`}
                  tenantId={active.id}
                  printerId={p.id}
                  devices={devices.filter((x) => x.printerId === p.id)}
                  canManage={manages}
                  downloadUrl={printAgentDownload()}
                  locale={ctx.locale}
                  d={pr}
                />
              )}
            </details>
          ))}
          {manages && (
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
          {formats && (
            <LabelFormatsForm
              key={`formats-${active.id}`}
              tenantId={active.id}
              formats={formats}
              canEdit={manages}
              d={pr}
              intake={d.intake}
            />
          )}
          {formats && templates && (
            <LabelTemplatesForm
              key={`templates-${active.id}`}
              tenantId={active.id}
              templates={templates}
              builtins={{
                bag: builtinTemplate('bag', {
                  widthMm: formats.bag.widthMm,
                  heightMm: formats.bag.heightMm,
                  dpi: previewDpi,
                }),
                garment: builtinTemplate('garment', {
                  widthMm: formats.garment.widthMm,
                  heightMm: formats.garment.heightMm,
                  dpi: previewDpi,
                }),
                item: builtinTemplate('item', {
                  widthMm: formats.item.widthMm,
                  heightMm: formats.item.heightMm,
                  dpi: previewDpi,
                }),
                markdown: builtinTemplate('markdown', {
                  widthMm: formats.markdown.widthMm,
                  heightMm: formats.markdown.heightMm,
                  dpi: previewDpi,
                }),
                onboarding: builtinTemplate('onboarding', {
                  widthMm: formats.onboarding.widthMm,
                  heightMm: formats.onboarding.heightMm,
                  dpi: previewDpi,
                }),
              }}
              canEdit={manages}
              dpi={previewDpi}
              d={pr}
              intake={d.intake}
            />
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
      {tab === 'store' && (
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
                      query.billing === 'success' ||
                      query.billing === 'cancelled'
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
      )}
    </>
  )
}
