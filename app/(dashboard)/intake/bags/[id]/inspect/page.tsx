import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { InspectionForm } from '@/components/intake/inspection-form'

export default async function InspectBag({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ draft?: string }>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const ctx = await requirePlatform()
  const { id } = await params
  const { draft } = await searchParams
  if (
    !z.uuid().safeParse(id).success ||
    (draft !== undefined && !z.uuid().safeParse(draft).success)
  )
    notFound()
  const tenantId = ctx.active!.id
  const { data: bag, error } = await ctx.client
    .from('bag_receipts')
    .select('reference,note')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error('Unable to load inspection bag')
  if (!bag) notFound()
  const columns = 'draft_id,revision,description,category,condition,saved_at'
  const [list, selected] = await Promise.all([
    ctx.client
      .from('inspection_current')
      .select(columns)
      .eq('tenant_id', tenantId)
      .eq('bag_id', id)
      .order('saved_at', { ascending: false })
      .order('draft_id')
      .limit(50),
    draft
      ? ctx.client
          .from('inspection_current')
          .select(columns)
          .eq('tenant_id', tenantId)
          .eq('bag_id', id)
          .eq('draft_id', draft)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (list.error || selected.error)
    throw new Error('Unable to load inspection drafts')
  if (draft && !selected.data) notFound()
  const d = dictionary(ctx.locale),
    s = d.inspection
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">
          {ctx.active!.name} · {d.intake.bag} K-{bag.reference}
        </p>
        <h1>{s.title}</h1>
        <p>{s.pilot}</p>
      </div>
      <div className="row">
        <Link className="text-link" href={`/intake/bags/${id}`}>
          {s.bag}
        </Link>
        <Link className="text-link" href="/intake">
          {d.intake.back}
        </Link>
      </div>
      {bag.note && <p>{bag.note}</p>}
      {ctx.active!.role !== 'readonly' && (
        <InspectionForm
          key={`${tenantId}:${id}:${draft ?? 'new'}`}
          tenantId={tenantId}
          bagId={id}
          current={selected.data}
          d={d}
        />
      )}
      <section className="card intake-form">
        <h2>{s.list}</h2>
        <p>{s.listHint}</p>
        {!list.data?.length && <p>{s.empty}</p>}
        <ul>
          {list.data?.map((item) => (
            <li key={item.draft_id} className="inspection-item">
              <Link className="text-link" href={`?draft=${item.draft_id}`}>
                {item.description}
              </Link>
              <p>
                {item.category} {item.condition}
              </p>
              <small>
                {s.version} {item.revision} ·{' '}
                {new Date(item.saved_at).toLocaleString(
                  ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                  { timeZone: 'Europe/Stockholm' },
                )}
              </small>
            </li>
          ))}
        </ul>
      </section>
      {selected.data && (
        <section className="card intake-form">
          <h2>{s.savedDetails}</h2>
          <p>{selected.data.description}</p>
          <p>{selected.data.category}</p>
          <p>{selected.data.condition}</p>
          <p>
            {s.version} {selected.data.revision}
          </p>
        </section>
      )}
    </>
  )
}
