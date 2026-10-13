import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Image from 'next/image'
import Link from '@/components/platform/working-link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readItemLabel } from '@/lib/engine/item-label'
import { formatOre } from '@/lib/engine/items'
import { itemBarcode } from '@/lib/labels/browser-barcode'
import { PrintLabel } from '@/components/intake/print-label'
import { ItemPrintDialog } from '@/components/intake/item-print-dialog'
import { readPrinters } from '@/lib/engine/printing'
import { readItem } from '@/lib/engine/items'

export default async function ItemLabel({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const id = z.guid().safeParse((await params).id)
  if (!id.success) notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  const all = dictionary(ctx.locale)
  const d = all.printing
  const [label, printers, item] = await Promise.all([
    readItemLabel(ctx.client, active.id, id.data),
    readPrinters(ctx.client, active.id),
    readItem(ctx.client, active.id, id.data),
  ])
  const svg = label?.priceOre != null ? itemBarcode(label.reference) : null
  const dimensions = svg?.match(/viewBox="0 0 (\d+) (\d+)"/)
  return (
    <div className="item-label-page">
      <div className="no-print">
        <Link className="text-link" href={'/intake/items/' + id.data}>
          {d.browserBack}
        </Link>
        <div className="page-heading">
          <h1>{d.itemLabel}</h1>
          <p>{d.browserHint}</p>
        </div>
        <div className="item-detail-shortcuts">
          {item && active.role !== 'readonly' && (
            <ItemPrintDialog
              tenantId={active.id}
              itemId={id.data}
              printers={printers}
              kind={item.prices.length > 1 ? 'markdown' : 'item'}
              manage={['owner', 'admin'].includes(active.role)}
              d={d}
              intake={all.intake}
            />
          )}
          {svg && <PrintLabel label={d.browserOpen} />}
        </div>
      </div>
      {label && svg && dimensions ? (
        <article className="item-browser-label" aria-label={d.itemLabel}>
          <p className="item-browser-label-store">{active.name}</p>
          <h2>{label.title || d.itemLabel}</h2>
          <p className="item-browser-label-price">
            {formatOre(label.priceOre!)} {label.currency}
          </p>
          <Image
            unoptimized
            src={
              'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
            }
            alt={label.reference}
            width={Number(dimensions[1])}
            height={Number(dimensions[2])}
          />
          <p className="item-browser-label-reference">{label.reference}</p>
        </article>
      ) : (
        <p className="no-print" role="status">
          {d.browserUnavailable}
        </p>
      )}
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.printing.itemLabel)
