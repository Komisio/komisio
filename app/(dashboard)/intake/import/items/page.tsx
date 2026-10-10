import { notFound } from 'next/navigation'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { ImportInventoryPreview } from '@/components/intake/import-inventory-preview'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'

export const generateMetadata = () =>
  platformPageMetadata((d) => d.inventoryImport.title)
export default async function InventoryImport() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  if (!['owner', 'admin'].includes(ctx.active!.role)) notFound()
  const all = dictionary(ctx.locale),
    d = all.inventoryImport
  const currency = await readStoreCurrency(ctx.client, ctx.active!.id)
  return (
    <>
      <Link className="text-link" href="/intake/import">
        {all.importer.title}
      </Link>
      <div className="page-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{
            label: d.helpLabel,
            steps: [d.helpFile, d.helpSeller, d.helpTerms],
          }}
        />
      </div>
      <ImportInventoryPreview
        key={ctx.active!.id}
        tenantId={ctx.active!.id}
        currency={currency}
        d={d}
        intake={all.intake}
        leaveUnsaved={all.leaveUnsaved}
      />
    </>
  )
}
