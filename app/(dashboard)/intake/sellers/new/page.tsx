import { platformPageMetadata } from '@/lib/platform/page-metadata'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { ReceivingPanel } from '@/components/intake/receiving-panel'
import type { AgreementSummary } from '@/components/intake/seller-agreement-fields'

export default async function NewSeller() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  if (active.role === 'readonly') redirect('/intake/sellers')
  const d = dictionary(ctx.locale)
  const agreement = await ctx.client
    .from('seller_agreement_versions')
    .select('id,title,version,language')
    .eq('tenant_id', active.id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (agreement.error) throw new Error('Unable to read current agreement')
  return (
    <div className="seller-registration-page">
      <div className="page-heading">
        <h1>{d.sellersList.title}</h1>
        <Link className="text-link" href="/intake/sellers">
          ← {d.sellersList.title}
        </Link>
      </div>
      <ReceivingPanel
        key={active.id}
        tenantId={active.id}
        seller={null}
        d={d.intake}
        details={d.sellerDetails}
        changeSellerLabel={d.quickIntake.changeSeller}
        registrationDestination="seller"
        agreement={agreement.data as AgreementSummary | null}
        agreements={d.agreements}
      />
    </div>
  )
}

export const generateMetadata = () =>
  platformPageMetadata((d) => d.reception.registerSeller)
