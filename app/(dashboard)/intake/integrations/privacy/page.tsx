import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readShopifyPrivacy } from '@/lib/engine/shopify-privacy'
import { ShopifyPrivacyQueue } from '@/components/intake/shopify-privacy'

export default async function ShopifyPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePlatform(false)
  const unmatched = (await searchParams).unmatched === '1'
  const host = unmatched ? await ctx.client.rpc('is_platform_host') : null
  if (
    unmatched
      ? host?.data !== true
      : !ctx.active || !['owner', 'admin'].includes(ctx.active.role)
  )
    notFound()
  const tenantId = unmatched ? null : ctx.active!.id
  const d = dictionary(ctx.locale).shopifyPrivacy
  const rows = await readShopifyPrivacy(ctx.client, tenantId)
  return (
    <>
      <div className="page-heading">
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake/integrations">
          {d.back}
        </Link>
      </div>
      <ShopifyPrivacyQueue
        rows={rows}
        tenantId={tenantId}
        locale={ctx.locale}
        d={d}
      />
    </>
  )
}
