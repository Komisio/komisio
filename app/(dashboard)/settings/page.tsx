import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { LegalLinks } from '@/components/platform/legal-links'
import { legalBaseUrl as configuredLegalBaseUrl } from '@/lib/platform/legal'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { VocabularySettings } from '@/components/intake/vocabulary-settings'
import { readAttributeVocabulary } from '@/lib/engine/attributes'
import { readAssortmentGroups } from '@/lib/engine/item-classification'
import { readItemCategories } from '@/lib/engine/item-categories'
import { Button } from '@/components/ui/button'
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
  'vocabulary',
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
  const legalBaseUrl = configuredLegalBaseUrl(
    process.env.KOMISIO_LEGAL_BASE_URL,
  )
  const hasLegal = Boolean(legalBaseUrl)
  const purchaseLinks = (
    <LegalLinks
      locale={ctx.locale}
      baseUrl={legalBaseUrl}
      d={d.legal}
      pricing
    />
  )
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
  const [vocabulary, assortmentGroups, categories] =
    intake && tab === 'vocabulary'
      ? await Promise.all([
          readAttributeVocabulary(ctx.client, active.id),
          readAssortmentGroups(ctx.client, active.id),
          readItemCategories(ctx.client, active.id),
        ])
      : [null, [], []]
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
        <FormHelpHeading
          key={tab}
          title={d.tenant}
          level={1}
          help={{
            label: `${d.settingsHelp.label}: ${d.settingsTabs[tab]}`,
            steps: d.settingsHelp[tab],
          }}
        />
        {hasLegal && <a href="#settings-legal">{d.legal.title}</a>}
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
      {tab === 'policy' && policy && active.role !== 'readonly' && (
        <p>
          <Link href="/settings/seller-registration">
            {d.selfRegistration.title}
          </Link>
        </p>
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
      {tab === 'vocabulary' && vocabulary && (
        <VocabularySettings
          key={active.id}
          tenantId={active.id}
          initial={vocabulary}
          groups={assortmentGroups}
          categories={categories}
          locale={ctx.locale}
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
          purchaseLinks={purchaseLinks}
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
          <div className="printing-heading">
            <h2>{pr.title}</h2>
            <Button asChild variant="secondary">
              <a href={printAgentDownload()}>{pr.download}</a>
            </Button>
          </div>
          <WorkspaceTabs
            id="printing"
            label={pr.title}
            scrollAnchors
            initial={requestedJob !== null ? 'history' : 'printers'}
            tabs={[
              {
                id: 'printers',
                label: pr.tabs.printers,
                content: (
                  <div className="printing-printers">
                    <p className="printing-hint">{pr.networkSupport}</p>
                    {printers.length === 0 && <p>{pr.none}</p>}
                    {printers.map((p) => (
                      <details key={p.id}>
                        <summary>
                          {p.name} ·{' '}
                          {p.transport === 'tcp' ? p.address : pr.usb} ·{' '}
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
                            devices={devices.filter(
                              (x) => x.printerId === p.id,
                            )}
                            canManage={manages}
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
                  </div>
                ),
              },
              {
                id: 'install',
                label: pr.tabs.install,
                content: (
                  <div className="printing-install">
                    <h3>Komisio Print</h3>
                    <p>{pr.installIntro}</p>
                    <ol>
                      <li>
                        <strong>{pr.installDownload}</strong>
                        <p>{pr.installDownloadHint}</p>
                      </li>
                      <li>
                        <strong>{pr.installPair}</strong>
                        <p>{pr.installPairHint}</p>
                        <a className="text-link" href="#printing-printers">
                          {pr.tabs.printers}
                        </a>
                      </li>
                      <li>
                        <strong>{pr.installRun}</strong>
                        <p>{pr.installRunHint}</p>
                      </li>
                    </ol>
                    <p className="printing-hint">{pr.installRunning}</p>
                  </div>
                ),
              },
              {
                id: 'labels',
                label: pr.tabs.labels,
                content: (
                  <>
                    <p className="printing-hint">
                      {pr.paperHint}{' '}
                      <Link className="text-link" href="/help/labels">
                        {d.helpCenter.articles.labels.title}
                      </Link>
                    </p>
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
                        leaveUnsaved={d.leaveUnsaved}
                      />
                    )}
                  </>
                ),
              },
              {
                id: 'history',
                label: pr.tabs.history,
                anchors: ['print-jobs', 'selected-print-job'],
                content: (
                  <>
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
                    <section
                      className="printing-jobs"
                      aria-labelledby="print-jobs"
                    >
                      <h3 id="print-jobs" tabIndex={-1}>
                        {pr.jobs}
                      </h3>
                      {jobs.length === 0 && <p>{pr.noJobs}</p>}
                      {recentJobs.map(jobDetails)}
                    </section>
                  </>
                ),
              },
            ]}
          />
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
                    purchaseLinks={purchaseLinks}
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
      {hasLegal && (
        <section
          className="card"
          id="settings-legal"
          aria-labelledby="settings-legal-title"
        >
          <h2 id="settings-legal-title">{d.legal.title}</h2>
          <LegalLinks locale={ctx.locale} baseUrl={legalBaseUrl} d={d.legal} />
        </section>
      )}
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.tenant)
