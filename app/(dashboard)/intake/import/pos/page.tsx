import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary } from '@/lib/i18n'
import { readStoreCurrency } from '@/lib/engine/money'
import { readSellersOverviewPage } from '@/lib/engine/sellers'
import { FormHelpHeading } from '@/components/help/form-help-heading'
import { PosImport } from '@/components/intake/pos-import'

export const generateMetadata = () =>
  platformPageMetadata((d) => d.posImport.title)
export default async function PosImportPage() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  if (!['owner', 'admin'].includes(ctx.active!.role)) notFound()
  const d = dictionary(ctx.locale)
  const [currency, sellers] = await Promise.all([
    readStoreCurrency(ctx.client, ctx.active!.id),
    readSellersOverviewPage(ctx.client, ctx.active!.id, '', 0, 12),
  ])
  return (
    <>
      <div className="page-heading">
        <FormHelpHeading
          title={d.posImport.title}
          level={1}
          help={{
            label: d.posImport.helpLabel,
            steps: [
              d.posImport.helpSource,
              d.posImport.terms,
              d.posImport.helpLink,
            ],
          }}
        />
      </div>
      <PosImport
        key={ctx.active!.id}
        tenantId={ctx.active!.id}
        currency={currency}
        d={d.posImport}
        quick={d.quickIntake}
        leaveUnsaved={d.leaveUnsaved}
        sellers={
          sellers?.sellers.map(({ id, name, contact }) => ({
            id,
            name,
            contact,
          })) ?? []
        }
        sellerCount={sellers?.total ?? 0}
      />
    </>
  )
}
