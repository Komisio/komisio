import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from '@/components/platform/working-link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary, intlLocale } from '@/lib/i18n'
import { PrintLabel } from '@/components/intake/print-label'
import { PrintJobButton } from '@/components/intake/print-job-button'
import { readPrinters } from '@/lib/engine/printing'
import {
  readGarmentReceipt,
  garmentReference,
} from '@/lib/engine/garment-receipts'

export default async function GarmentLabel({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const custody = await readGarmentReceipt(ctx.client, ctx.active!.id, id)
  if (!custody) notFound()
  const all = dictionary(ctx.locale),
    d = all.reception
  const printers = await readPrinters(ctx.client, ctx.active!.id)
  const canPrint = ctx.active!.role !== 'readonly'
  const hasPrinter = printers.some((printer) => printer.active)
  return (
    <div className="bag-label-page reception-label-page">
      <Link className="text-link no-print" href={`/intake/reception/${id}`}>
        {d.labelBack}
      </Link>
      <div className="page-heading no-print">
        <h1>{all.printing.kinds.garment}</h1>
        <p>{d.labelHint}</p>
      </div>
      <div className="bag-label-workspace">
        <section className="bag-label-preview" aria-labelledby="label-content">
          <h2 id="label-content" className="no-print">
            {d.labelContent}
          </h2>
          <article className="bag-label">
            <strong>{ctx.active!.name}</strong>
            <h2>{garmentReference(custody.reference)}</h2>
            <p>
              {all.intake.receivedAt}:{' '}
              <time dateTime={custody.received_at}>
                {new Date(custody.received_at).toLocaleDateString(
                  intlLocale(ctx.locale),
                  { timeZone: 'Europe/Stockholm' },
                )}
              </time>
            </p>
          </article>
        </section>
        <section
          className="card bag-label-print no-print"
          aria-labelledby="label-print"
        >
          {canPrint && (
            <>
              <h2 id="label-print">{all.printing.zebraPrint}</h2>
              <PrintJobButton
                tenantId={ctx.active!.id}
                printers={printers}
                kind="garment"
                referenceKind="garment_receipt"
                referenceId={custody.id}
                d={all.printing}
                intake={all.intake}
                compact
              />
              {!hasPrinter && ['owner', 'admin'].includes(ctx.active!.role) && (
                <Link className="text-link" href="/settings?tab=printing">
                  {all.printing.title}
                </Link>
              )}
            </>
          )}
          {!canPrint && <h2 id="label-print">{all.printing.browserOpen}</h2>}
          <div className={canPrint ? 'bag-label-alternative' : undefined}>
            <PrintLabel label={all.printing.browserOpen} variant="secondary" />
          </div>
        </section>
      </div>
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.printing.kinds.garment)
