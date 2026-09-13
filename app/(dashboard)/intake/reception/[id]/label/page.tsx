import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
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
  return (
    <>
      <div className="page-heading no-print">
        <h1>{d.custodyPrint}</h1>
        <p>{d.custodyHelp}</p>
      </div>
      <article className="bag-label">
        <strong>{ctx.active!.name}</strong>
        <h2>
          {d.custodyReference} {garmentReference(custody.reference)}
        </h2>
        <p>
          {all.intake.receivedAt}:{' '}
          {new Date(custody.received_at).toLocaleDateString(
            ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
            { timeZone: 'Europe/Stockholm' },
          )}
        </p>
      </article>
      <div className="row no-print">
        <PrintLabel label={all.intake.print} />
        <PrintJobButton
          tenantId={ctx.active!.id}
          printers={printers}
          kind="garment"
          referenceKind="garment_receipt"
          referenceId={custody.id}
          d={all.printing}
          intake={all.intake}
        />
        <Link className="text-link" href={`/intake/reception/${id}`}>
          {d.back}
        </Link>
      </div>
    </>
  )
}
