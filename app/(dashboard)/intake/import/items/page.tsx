import { notFound } from 'next/navigation'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { PosImport } from '@/components/intake/pos-import'
import { WorkspaceTabs } from '@/components/ui/workspace-tabs'
import { readSellersOverviewPage } from '@/lib/engine/sellers'
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
  const [currency, sellers] = await Promise.all([
    readStoreCurrency(ctx.client, ctx.active!.id),
    readSellersOverviewPage(ctx.client, ctx.active!.id, '', 0, 12),
  ])
  return (
    <>
      <div className="page-heading">
        <FormHelpHeading
          title={d.title}
          level={1}
          help={{
            label: d.helpLabel,
            steps: [
              d.helpFile,
              d.helpSeller,
              d.helpTerms,
              all.posImport.helpSource,
              all.posImport.helpLink,
            ],
          }}
        />
      </div>
      <WorkspaceTabs
        key={ctx.active!.id}
        id="item-import"
        label={d.title}
        tabs={[
          {
            id: 'file',
            label: d.fromFile,
            content: (
              <ImportInventoryPreview
                tenantId={ctx.active!.id}
                currency={currency}
                d={d}
                intake={all.intake}
                leaveUnsaved={all.leaveUnsaved}
              />
            ),
          },
          {
            id: 'pos',
            label: d.fromPos,
            content: (
              <PosImport
                tenantId={ctx.active!.id}
                currency={currency}
                d={all.posImport}
                quick={all.quickIntake}
                leaveUnsaved={all.leaveUnsaved}
                sellers={
                  sellers?.sellers.map(({ id, name, contact }) => ({
                    id,
                    name,
                    contact,
                  })) ?? []
                }
                sellerCount={sellers?.total ?? 0}
              />
            ),
          },
        ]}
      />
    </>
  )
}
