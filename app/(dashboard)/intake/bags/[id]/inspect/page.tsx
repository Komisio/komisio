import { itemSort } from '@/lib/engine/item-directory'
import { platformPageMetadata } from '@/lib/platform/page-metadata'
import { BagReception } from '@/components/intake/bag-reception'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'

export default async function InspectBag({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const { id } = await params
  if (!z.uuid().safeParse(id).success) notFound()
  const query = await searchParams
  const tenantId = ctx.active!.id
  const bag = await ctx.client
    .from('bag_receipts')
    .select('id,reference,note')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (bag.error) throw new Error('Unable to read drop-off')
  if (!bag.data) notFound()
  return (
    <BagReception
      client={ctx.client}
      tenantId={tenantId}
      bagId={id}
      reference={bag.data.reference}
      note={bag.data.note}
      locale={ctx.locale}
      sort={itemSort.safeParse(query.itemSort).data ?? 'accepted'}
      direction={query.itemDirection === 'asc' ? 'asc' : 'desc'}
      role={ctx.active!.role}
      readonly={ctx.active!.role === 'readonly'}
      itemPage={
        typeof query.itemPage === 'string' &&
        /^[1-9]\d{0,6}$/.test(query.itemPage)
          ? Number(query.itemPage)
          : 1
      }
    />
  )
}
export const generateMetadata = () =>
  platformPageMetadata((d) => d.inspection.title)
