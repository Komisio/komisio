import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import { readZettleStatus, zettlePageCursor } from '@/lib/engine/zettle'
import { zettleFixturesEnabled } from '@/extensions/zettle/fixtures'
import { ZettleAction } from '@/components/intake/zettle-action'
import { formatSignedOre } from '@/lib/engine/seller-ledger'
export default async function Integrations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.KOMISIO_INTAKE_ENABLED !== 'true') notFound()
  const params = await searchParams
  const paging =
    params.before || params.id
      ? zettlePageCursor.safeParse({ before: params.before, id: params.id })
      : null
  if (paging && !paging.success) notFound()
  const ctx = await requirePlatform(),
    a = ctx.active!,
    all = dictionary(ctx.locale),
    d = all.zettle,
    state = await readZettleStatus(
      ctx.client,
      a.id,
      paging?.success ? paging.data : undefined,
    ),
    fixtures = zettleFixturesEnabled()
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">{a.name}</div>
        <h1>{d.title}</h1>
        <p>{d.intro}</p>
        <Link className="text-link" href="/intake">
          {all.intake.back}
        </Link>
      </div>
      <section className="card intake-form">
        <p className="intake-notice">{fixtures ? d.fixture : d.offline}</p>
        <p>
          {d.lastSync}:{' '}
          {state.lastSync
            ? new Date(state.lastSync).toLocaleString(ctx.locale, {
                timeZone: 'Europe/Stockholm',
              })
            : d.never}
        </p>
        {fixtures && a.role !== 'readonly' && (
          <ZettleAction
            key={`${a.id}-${state.lastSync}`}
            command={{ action: 'sync', tenantId: a.id, previous: state.cursor }}
            d={d}
            label={d.sync}
          />
        )}
        <h2>{d.recent}</h2>
        {!state.imports.length && <p>{d.empty}</p>}
        {state.imports.map((r) => (
          <p key={r.id}>
            <Link className="text-link" href={`/intake/integrations/${r.id}`}>
              {d.open} · {r.external_id}
            </Link>{' '}
            · {formatSignedOre(r.amount_ore)} {r.currency}
            {r.blocked_reason ? ` · ${d.blocked}` : ''}
          </p>
        ))}
        {state.next && (
          <p>
            <Link
              className="text-link"
              href={`/intake/integrations?${new URLSearchParams(state.next)}`}
            >
              {d.older}
            </Link>
          </p>
        )}
        {paging && (
          <p>
            <Link className="text-link" href="/intake/integrations">
              {d.newest}
            </Link>
          </p>
        )}
      </section>
    </>
  )
}
