import { readInspection } from '@/lib/engine/inspection-read'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  InspectionForm,
  InspectionArchiveForm,
} from '@/components/intake/inspection-form'
import {
  inspectionNavigation,
  inspectionHref as navigationHref,
} from '@/lib/intake/inspection-navigation'

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
  const navigation = inspectionNavigation.safeParse(await searchParams)
  if (!z.uuid().safeParse(id).success || !navigation.success) notFound()
  const { draft, version, historyBefore, after, before, status } =
    navigation.data
  const inspectionHref = (
    params: Record<string, string | number | undefined>,
  ) => navigationHref({ status, ...params })
  const tenantId = ctx.active!.id
  const {
    bag,
    items,
    selected,
    historical,
    past,
    historyHasMore,
    hasPrevious,
    hasNext,
  } = await readInspection(ctx.client, tenantId, {
    bagId: id,
    ...navigation.data,
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      ['INSPECTION_UNAVAILABLE', 'FORBIDDEN'].includes(error.message)
    )
      notFound()
    throw error
  })
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
      {ctx.active!.role !== 'readonly' && !version && !selected?.archived && (
        <InspectionForm
          key={`${tenantId}:${id}:${draft ?? 'new'}`}
          tenantId={tenantId}
          bagId={id}
          current={selected}
          d={d}
        />
      )}
      {selected && ctx.active!.role !== 'readonly' && !version && (
        <InspectionArchiveForm
          key={draft}
          tenantId={tenantId}
          bagId={id}
          current={selected}
          d={d}
        />
      )}
      {historical && (
        <section className="card intake-form inspection-historical">
          <h2>
            {s.historical} {historical.revision}
          </h2>
          <p>{s.historicalHint}</p>
          <p>{historical.archived ? s.archived : s.active}</p>
          {historical.change_reason && (
            <p>
              {s.reason}: {historical.change_reason}
            </p>
          )}
          <dl>
            {(['description', 'category', 'condition'] as const).map(
              (field) => (
                <div key={field}>
                  <dt>{s[field]}</dt>
                  <dd>{historical![field] || '—'}</dd>
                </div>
              ),
            )}
          </dl>
          <Link
            className="text-link"
            href={inspectionHref({ draft, after, before })}
          >
            {s.current}
          </Link>
        </section>
      )}
      {selected && (
        <section className="card intake-form">
          <h2>{s.savedDetails}</h2>
          <p>{selected.archived ? s.archived : s.active}</p>
          {selected.change_reason && (
            <p>
              {s.reason}: {selected.change_reason}
            </p>
          )}
          <p>{selected.description}</p>
          <p>{selected.category}</p>
          <p>{selected.condition}</p>
          <p>
            {s.version} {selected.revision}
          </p>
        </section>
      )}
      {draft && (
        <section className="card intake-form inspection-history">
          <h2>{s.history}</h2>
          <p>{s.historyHint}</p>
          <ul>
            {past.map((entry) => (
              <li key={entry.revision}>
                <Link
                  className="text-link"
                  href={inspectionHref({
                    draft,
                    version: entry.revision,
                    historyBefore,
                    after,
                    before,
                  })}
                >
                  {s.version} {entry.revision}
                </Link>{' '}
                · {entry.archived ? s.archived : s.active} ·{' '}
                {new Date(entry.saved_at).toLocaleString(
                  ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                  { timeZone: 'Europe/Stockholm' },
                )}
              </li>
            ))}
          </ul>
          {!past.length && <p>{s.noHistory}</p>}
          <nav className="row" aria-label={s.history}>
            {historyHasMore && (
              <Link
                className="text-link"
                href={inspectionHref({
                  draft,
                  version,
                  historyBefore: past.at(-1)!.revision,
                  after,
                  before,
                })}
              >
                {s.older}
              </Link>
            )}
            {historyBefore && (
              <Link
                className="text-link"
                href={inspectionHref({ draft, version, after, before })}
              >
                {s.latest}
              </Link>
            )}
          </nav>
        </section>
      )}
      <section className="card intake-form">
        <h2>{s.list}</h2>
        <p>{s.listHint}</p>
        <nav className="row" aria-label={s.filterLabel}>
          {(['active', 'archived', 'all'] as const).map((value) => (
            <Link
              key={value}
              className="text-link"
              aria-current={status === value ? 'page' : undefined}
              href={inspectionHref({ status: value, draft, version })}
            >
              {value === 'active'
                ? s.filterActive
                : value === 'archived'
                  ? s.filterArchived
                  : s.filterAll}
            </Link>
          ))}
        </nav>
        {!items.length && <p>{after || before ? s.emptyPage : s.empty}</p>}
        <ul>
          {items.map((item) => (
            <li key={item.draft_id} className="inspection-item">
              <Link
                className="text-link"
                href={inspectionHref({ draft: item.draft_id, after, before })}
              >
                {item.description}
              </Link>
              <p>
                {item.category} {item.condition}
              </p>
              <small>
                {s.version} {item.revision} ·{' '}
                {item.archived ? s.archived : s.active} ·{' '}
                {new Date(item.saved_at).toLocaleString(
                  ctx.locale === 'sv' ? 'sv-SE' : 'en-GB',
                  { timeZone: 'Europe/Stockholm' },
                )}
              </small>
            </li>
          ))}
        </ul>
        <nav className="row" aria-label={s.pages}>
          {hasPrevious && items[0] && (
            <Link
              className="text-link"
              href={inspectionHref({
                draft,
                version,
                historyBefore,
                before: items[0].draft_id,
              })}
            >
              {s.previous}
            </Link>
          )}
          {hasNext && items.at(-1) && (
            <Link
              className="text-link"
              href={inspectionHref({
                draft,
                version,
                historyBefore,
                after: items.at(-1)!.draft_id,
              })}
            >
              {s.next}
            </Link>
          )}
          {(after || before) && (
            <Link
              className="text-link"
              href={inspectionHref({ draft, version, historyBefore })}
            >
              {s.first}
            </Link>
          )}
        </nav>
      </section>
    </>
  )
}
