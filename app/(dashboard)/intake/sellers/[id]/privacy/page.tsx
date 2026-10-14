import { notFound } from 'next/navigation'
import { z } from 'zod'
import Link from '@/components/platform/working-link'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { readSellerPrivacy } from '@/lib/engine/seller-privacy'
import { SellerPrivacy } from '@/components/intake/seller-privacy'

export default async function SellerPrivacyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  if (!['owner', 'admin'].includes(ctx.active!.role)) notFound()
  const id = z.uuid().safeParse((await params).id)
  if (!id.success) notFound()
  const result = await ctx.client
    .from('sellers')
    .select('name')
    .eq('tenant_id', ctx.active!.id)
    .eq('id', id.data)
    .maybeSingle()
  if (result.error) throw new Error('Unable to read seller')
  if (!result.data) notFound()
  const preview = await readSellerPrivacy(ctx.client, ctx.active!.id, id.data)
  const d = dictionary(ctx.locale).sellerPrivacy
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6">
      <Link
        className="text-link"
        href={`/intake/sellers/${id.data}#seller-details`}
      >
        {d.back}
      </Link>
      <header>
        <h1>{d.title}</h1>
        <p>{preview.closedAt ? d.closedName : result.data.name}</p>
      </header>
      <SellerPrivacy
        key={preview.revision}
        tenantId={ctx.active!.id}
        sellerId={id.data}
        preview={preview}
        d={d}
      />
    </div>
  )
}
export const generateMetadata = () =>
  platformPageMetadata((d) => d.sellerPrivacy.title)
