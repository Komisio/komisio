import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'

/** Resolve older proposal links to the draft's actual receiving form. */
export default async function DraftLocation({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const draft = z.uuid().safeParse((await searchParams).draft)
  if (!draft.success) notFound()
  const { data, error } = await ctx.client
    .from('inspection_current')
    .select('bag_id')
    .eq('tenant_id', ctx.active!.id)
    .eq('draft_id', draft.data)
    .maybeSingle()
  if (error) throw new Error('Unable to locate inspection draft')
  if (!data) notFound()
  const bagId = z.uuid().parse(data.bag_id)
  redirect(`/intake/bags/${bagId}/inspect?draft=${draft.data}`)
}
