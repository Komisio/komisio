import { notFound } from 'next/navigation'
import Link from '@/components/platform/working-link'
import { requirePlatform } from '@/lib/platform/context'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { dictionary } from '@/lib/i18n'
import { readMailHistory } from '@/lib/engine/store-mail'
import { StoreMail } from '@/components/intake/store-mail'
import './store-mail.css'
export const generateMetadata = () =>
  platformPageMetadata((d) => d.storeMail.title)
export default async function StoreMailPage() {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const active = ctx.active!
  if (!['owner', 'admin'].includes(active.role)) notFound()
  const d = dictionary(ctx.locale)
  const history = await readMailHistory(ctx.client, active.id)
  return (
    <div>
      <Link href="/intake/sellers">{d.sellersList.title}</Link>
      <h1>{d.storeMail.title}</h1>
      <StoreMail
        tenantId={active.id}
        initialHistory={history}
        d={d}
        locale={ctx.locale}
      />
    </div>
  )
}
