import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { ReceivingPanel } from '@/components/intake/receiving-panel'

export default async function NewSeller() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  if (active.role === 'readonly') redirect('/intake/sellers')
  const d = dictionary(ctx.locale)
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
      />
    </div>
  )
}
