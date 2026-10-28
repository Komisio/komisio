import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { BackLink } from '@/components/platform/back-link'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { PrintLabel } from '@/components/intake/print-label'
import { PrintJobButton } from '@/components/intake/print-job-button'
import { readPrinters } from '@/lib/engine/printing'
import { readStorePolicy } from '@/lib/engine/store-policy'

export default async function BagLabel({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const { data: bag, error } = await ctx.client
    .from('bag_receipts')
    .select('reference,received_at,agreement_version_id,agreement_evidence_id')
    .eq('tenant_id', ctx.active!.id)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Unable to load bag label')
  if (!bag) notFound()
  const d = dictionary(ctx.locale).intake
  const a = dictionary(ctx.locale).agreements
  const printing = dictionary(ctx.locale).printing
  const printers = await readPrinters(ctx.client, ctx.active!.id)
  const hasPrinter = printers.some((printer) => printer.active)
  const policy = await readStorePolicy(ctx.client, ctx.active!.id)
  const [version, evidence] = await Promise.all([
    bag.agreement_version_id
      ? ctx.client
          .from('seller_agreement_versions')
          .select('id,version,title')
          .eq('tenant_id', ctx.active!.id)
          .eq('id', bag.agreement_version_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    bag.agreement_evidence_id
      ? ctx.client
          .from('seller_agreement_evidence')
          .select('reference,recorded_at')
          .eq('tenant_id', ctx.active!.id)
          .eq('id', bag.agreement_evidence_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (version.error || evidence.error)
    throw new Error('Unable to load receipt agreement')
  return (
    <div className="bag-label-page">
      {/* Reload the queue: cached client navigation can retain #new-seller. */}
      <BackLink className="text-link no-print" href="/intake">
        {dictionary(ctx.locale).returnNavigation.back}
      </BackLink>
      <WorkspaceTabs
        id="bag-label"
        label={d.bag}
        tabs={[
          {
            id: 'print',
            label: d.queueLabel,
            content: (
              <>
                <div className="bag-label-workspace">
                  <section className="bag-label-preview">
                    <article className="bag-label">
                      <strong>{ctx.active!.name}</strong>
                      <h1>
                        {d.bag} K-{bag.reference}
                      </h1>
                      <p>
                        {d.receivedAt}:{' '}
                        {new Date(bag.received_at).toLocaleDateString(
                          intlLocale(ctx.locale),
                          { timeZone: 'Europe/Stockholm' },
                        )}
                      </p>
                    </article>
                  </section>
                  <section className="card bag-label-print no-print">
                    <h2>{d.print}</h2>
                    {hasPrinter ? (
                      <>
                        <PrintJobButton
                          tenantId={ctx.active!.id}
                          printers={printers}
                          kind="bag"
                          referenceKind="bag_receipt"
                          referenceId={id}
                          d={{ ...printing, queue: d.print }}
                          intake={d}
                          compact
                        />
                        <div className="bag-label-alternative">
                          <PrintLabel label={d.browserPrint} />
                        </div>
                      </>
                    ) : (
                      <PrintLabel label={d.browserPrint} />
                    )}
                  </section>
                </div>
                <div className="bag-label-next no-print">
                  <Link
                    className="text-link"
                    href={`/intake/bags/${id}/inspect`}
                  >
                    {dictionary(ctx.locale).inspection.title} →
                  </Link>
                </div>
              </>
            ),
          },
          {
            id: 'agreement',
            label: a.tabLabel,
            status: {
              approved: Boolean(evidence.data),
              label: evidence.data ? a.tabApproved : a.tabMissing,
            },
            content: (
              <section className="card bag-label-agreement no-print">
                <h2>{a.receiptAgreement}</h2>
                <div className="intake-form">
                  {version.data ? (
                    <>
                      <Link
                        className="text-link"
                        href={`/intake/agreements?version=${version.data.id}`}
                      >
                        {version.data.title} · {a.version}{' '}
                        {version.data.version}
                      </Link>
                      <p>
                        {evidence.data
                          ? `${a.staffRecorded}: ${evidence.data.reference}`
                          : a.noEvidence}
                      </p>
                    </>
                  ) : (
                    <p>
                      {policy.policy.agreementRequiredFor.length === 0
                        ? a.optionalReceiptAgreement
                        : a.noReceiptAgreement}
                    </p>
                  )}
                </div>
              </section>
            ),
          },
        ]}
      />
    </div>
  )
}

export const generateMetadata = () => platformPageMetadata((d) => d.intake.bag)
