import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { readStorePolicy } from '@/lib/engine/store-policy'
import { z } from 'zod'
import { StorePolicyForm } from '@/components/intake/store-policy-form'
import { StoreProfileForm } from '@/components/intake/store-profile-form'
import { readStoreProfile } from '@/lib/engine/store-profile'
import { PrinterForm } from '@/components/intake/printer-form'
import {
  readLabelFormats,
  readLabelTemplates,
  readPrinters,
  readPrintJobs,
  readPrintJob,
  readPrintReferences,
  type PrintJob,
} from '@/lib/engine/printing'
import { PrintJobDetails } from '@/components/intake/print-job-details'
import { LabelFormatsForm } from '@/components/intake/label-formats-form'
import { LabelTemplatesForm } from '@/components/intake/label-templates-form'
import { builtinTemplate } from '@/lib/labels/placeholders'
import { PrintDevices } from '@/components/intake/print-devices'
import {
  printAgentDownload,
  readPrintDevices,
} from '@/lib/engine/print-devices'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { storeCountries } from '@/lib/platform/countries'
import { can } from '@/lib/platform/permissions'
import { TenantForm } from '@/components/platform/tenant-form'
import { PlanPanel } from '@/components/platform/plan-panel'
import { readPlanStatus } from '@/lib/engine/plans'
import { BillingActions } from '@/components/platform/billing-actions'
import { stripeConfigured } from '@/extensions/stripe/api'
import { readChainOverview } from '@/lib/engine/chains'
import { ChainPanel } from '@/components/platform/chain-panel'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { ConnectorsPanel } from '@/components/platform/connectors-panel'
import { AiCreditsPanel } from '@/components/platform/ai-credits-panel'
import { readAiCredits } from '@/lib/engine/ai-credits'
import {
  creditPriceForCountry,
  creditPackOre,
} from '@/lib/platform/credit-prices'
import { stripeCreditsConfigured } from '@/extensions/stripe/api'
import {
  appOrigin,
  connectorsEnabled,
  mcpPath,
  readConnectors,
} from '@/lib/engine/connectors'

const tabs = [
  'policy',
  'profile',
  'store',
  'printing',
  'credits',
  'connectors',
] as const
type Tab = (typeof tabs)[number]

/**
 * Store settings in available tabs. Only the selected tab's data beyond the shared
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
  const countryNames = new Intl.DisplayNames([intlLocale(ctx.locale)], {
    type: 'region',
  })
  // Serialize translated labels once; browser/server ICU versions may differ.
  const countryOptions = storeCountries.map((code) => ({
    code,
    label: countryNames.of(code) ?? code,
  }))
  const active = ctx.active!
  const intake = process.env.KOMISIO_INTAKE_ENABLED === 'true'
  const visible = tabs.filter(
    (t) =>
      (intake || t === 'store') && (t !== 'connectors' || connectorsEnabled()),
  )
  const tab: Tab = !intake
    ? 'store'
    : visible.includes(query.tab as Tab)
      ? (query.tab as Tab)
      : query.billing
        ? 'store'
        : query.credits
          ? 'credits'
          : 'policy'
  const manages = ['owner', 'admin'].includes(active.role)
  const policy =
    intake && tab === 'policy'
      ? await readStorePolicy(ctx.client, active.id)
      : null
  const profile =
    (intake && tab === 'profile') || tab === 'credits'
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
  const requestedJob = typeof query.job === 'string' ? query.job : null
  const parsedJob = z.uuid().safeParse(requestedJob)
  const selectedJob =
    intake && tab === 'printing' && parsedJob.success
      ? (jobs.find((job) => job.id === parsedJob.data) ??
        (await readPrintJob(ctx.client, active.id, parsedJob.data)))
      : null
  const recentJobs = jobs
    .slice(0, 20)
    .filter((job) => job.id !== selectedJob?.id)
  const references = await readPrintReferences(
    ctx.client,
    active.id,
    selectedJob ? [...recentJobs, selectedJob] : recentJobs,
  )
  const printerNames = new Map(
    printers.map((printer) => [printer.id, printer.name]),
  )
  const previewDpi = (printers.find((p) => p.active)?.dpi ?? 203) as
    203 | 300 | 600
  const plan =
    tab === 'store' || tab === 'connectors'
      ? await readPlanStatus(ctx.client, active.id)
      : null
  const connectors =
    tab === 'connectors' ? await readConnectors(ctx.client, active.id) : null
  const aiCredits =
    tab === 'credits' ? await readAiCredits(ctx.client, active.id) : null
  const creditPrice = creditPriceForCountry(profile?.profile?.address.country)
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
  const pr = d.printing
  const jobDetails = (job: PrintJob) => (
    <PrintJobDetails
      key={job.id}
      job={job}
      printer={printerNames.get(job.printer_id)}
      reference={references.get(`${job.reference_kind}:${job.reference_id}`)}
      locale={ctx.locale}
      d={pr}
    />
  )
  return (
    <div className="settings-page">
      <div className="page-heading">
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
      {tab === 'profile' && profile && (
        <StoreProfileForm
          countryOptions={countryOptions}
          key={`${active.id}-${profile.id ?? 'none'}`}
          tenantId={active.id}
          current={profile}
          editable={manages}
          locale={ctx.locale}
          d={d}
        />
      )}
      {tab === 'credits' && aiCredits && (
        <AiCreditsPanel
          tenantId={active.id}
          state={aiCredits}
          canManage={manages}
          canBuy={
            manages &&
            aiCredits.packOre === creditPackOre &&
            stripeCreditsConfigured(process.env, creditPrice.currency)
          }
          price={creditPrice}
          locale={ctx.locale}
          d={d.credits}
        />
      )}
      {tab === 'connectors' && connectorsEnabled() && (
        <ConnectorsPanel
          tenantId={active.id}
          connectors={connectors ?? []}
          endpoint={`${appOrigin()}${mcpPath}`}
          locale={ctx.locale}
          d={d.connectors}
        />
      )}
      {tab === 'printing' && (
        <section
          className="card intake-form printing-workspace"
          aria-label={pr.title}
        >
          <h2>{pr.title}</h2>
          <p>{pr.intro}</p>
          <Link className="text-link" href="/help/labels">
            {d.helpCenter.articles.labels.title}
          </Link>
          {requestedJob !== null && (
            <section aria-labelledby="selected-print-job">
              <h3 id="selected-print-job" tabIndex={-1}>
                {pr.selectedJob}
              </h3>
              {selectedJob ? (
                jobDetails(selectedJob)
              ) : (
                <p role="status">{pr.jobUnavailable}</p>
              )}
            </section>
          )}
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
                  leaveUnsaved={d.leaveUnsaved}
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
            <details
              className="printer-register-fold"
              open={printers.length === 0}
            >
              <summary>{pr.registerHeading}</summary>
              <PrinterForm
                key={`new-${printers.length}`}
                tenantId={active.id}
                d={pr}
                intake={d.intake}
                leaveUnsaved={d.leaveUnsaved}
              />
            </details>
          )}
          <section className="printing-jobs" aria-labelledby="print-jobs">
            <h3 id="print-jobs" tabIndex={-1}>
              {pr.jobs}
            </h3>
            {jobs.length === 0 && <p>{pr.noJobs}</p>}
            {recentJobs.map(jobDetails)}
          </section>
          {formats && (
            <LabelFormatsForm
              key={`formats-${active.id}`}
              tenantId={active.id}
              formats={formats}
              canEdit={manages}
              d={pr}
              intake={d.intake}
              leaveUnsaved={d.leaveUnsaved}
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
            <details className="settings-technical">
              <summary>{d.technicalDetails}</summary>
              <div className="read-details">
                <strong>{d.slug}</strong>
                <p>{active.slug}</p>
                <strong>{d.tenantId}</strong>
                <p>{active.id}</p>
                <small>{d.tenantImmutable}</small>
              </div>
            </details>
          </section>
          {can(active.role, 'audit.read') && (
            <section className="card">
              <h2>{d.audit}</h2>
              <p>{d.auditHint}</p>
              {events.data?.map((e) => (
                <div key={e.id} className="audit-row">
                  <span>
                    {d.events[e.action as keyof typeof d.events] ?? (
                      <details>
                        <summary>{d.otherActivity}</summary>
                        <code>{e.action}</code>
                      </details>
                    )}
                  </span>
                  <small>
                    {new Date(e.occurred_at).toLocaleDateString(
                      intlLocale(ctx.locale),
                      {
                        timeZone: 'Europe/Stockholm',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      },
                    )}
                  </small>
                </div>
              ))}
              {!events.data?.length && <p>{d.noAudit}</p>}
            </section>
          )}
        </div>
      )}
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.tenant)
