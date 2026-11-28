import Link from 'next/link'
import { StoreApiKeys } from '@/components/platform/store-api-keys'
import { listInventoryKeys } from '@/lib/engine/store-inventory-api'
import { dictionary, intlLocale } from '@/lib/i18n'
import { requirePlatform } from '@/lib/platform/context'

export default async function StoreApiSettings() {
  const ctx = await requirePlatform()
  const tenant = ctx.active!
  const d = dictionary(ctx.locale).storeApi
  return (
    <section className="stack">
      <header className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link href="/developers/api">{d.reference}</Link>
      </header>
      {['owner', 'admin'].includes(tenant.role) && (
        <StoreApiKeys
          key={tenant.id}
          tenantId={tenant.id}
          locale={intlLocale(ctx.locale)}
          d={d}
          keys={await listInventoryKeys(ctx.client, tenant.id)}
        />
      )}
    </section>
  )
}
