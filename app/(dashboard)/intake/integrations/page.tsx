import { readZettleStock } from '@/lib/engine/zettle-stock'
import { readZettleImages } from '@/lib/engine/zettle-images'
import { readZettlePull } from '@/lib/engine/zettle-live'
import Link from 'next/link'
import { pilotIssue, pilotEnvironment } from '@/extensions/zettle/auth'
import { ZettleConnection } from '@/components/intake/zettle-connection'
import { notFound } from 'next/navigation'
import { requirePlatform } from '@/lib/platform/context'
import { dictionary } from '@/lib/i18n'
import {
  readZettleStatus,
  readZettleCatalog,
  zettlePageCursor,
} from '@/lib/engine/zettle'
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
    fixtures = zettleFixturesEnabled(),
    catalog = await readZettleCatalog(ctx.client, a.id),
    pull = ['owner', 'admin'].includes(a.role)
      ? await readZettlePull(ctx.client, a.id)
      : null,
    pilot = pilotEnvironment(process.env),
    liveReady = pilotIssue(a.id, pilot) === null && !!pilot.ZETTLE_MERCHANT_ID
  const stocks = ['owner', 'admin'].includes(a.role)
    ? await readZettleStock(ctx.client, a.id)
    : []
  const images =
    liveReady && pull?.connection
      ? await readZettleImages(ctx.client, a.id)
      : []
  const exportItems = [
    ...new Set([
      ...catalog.candidates.map((c) => c.item_id),
      ...stocks.map((s) => s.item_id),
      ...(images ?? []).map((image) => image.item_id),
    ]),
  ]
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
      {['owner', 'admin'].includes(a.role) && (
        <ZettleConnection
          key={a.id}
          tenantId={a.id}
          issue={pilotIssue(a.id, pilotEnvironment(process.env))}
          d={d}
        />
      )}
      {liveReady && pull && (
        <section className="card intake-form" aria-label={d.pullTitle}>
          <h2>{d.pullTitle}</h2>
          <p>{d.pullHint}</p>
          {pull.connection ? (
            <>
              <p>
                {d.pullSince}:{' '}
                {new Date(pull.connection.cutover).toLocaleString(ctx.locale, {
                  timeZone: 'Europe/Stockholm',
                })}
              </p>
              {pull.window && (
                <p>
                  {pull.page?.purchase_count === 0
                    ? d.pullComplete
                    : d.pullPending}
                  :{' '}
                  {new Date(pull.window.end_at).toLocaleString(ctx.locale, {
                    timeZone: 'Europe/Stockholm',
                  })}
                </p>
              )}
              <ZettleAction
                key={pull.page?.id ?? pull.window?.id ?? 'pull'}
                command={{ action: 'pull', tenantId: a.id }}
                d={d}
                label={d.pullNow}
              />
            </>
          ) : (
            <ZettleAction
              command={{ action: 'enablePull', tenantId: a.id }}
              d={d}
              label={d.pullEnable}
            />
          )}
        </section>
      )}
      <section className="card intake-form">
        <p className="intake-notice">
          {fixtures
            ? d.fixture
            : pull?.connection
              ? d.catalogOffline
              : d.offline}
        </p>
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
        <h2>{d.catalogTitle}</h2>
        <p>{d.catalogHint}</p>
        <p>
          {d.pendingProducts}: {catalog.candidates.length}
        </p>
        {liveReady && pull?.connection && (
          <section aria-label={d.stockTitle}>
            <h2>{d.stockTitle}</h2>
            <p>{d.stockHint}</p>
            {images !== null && <p>{d.imageHint}</p>}
            {exportItems.map((itemId) => {
              const stock = stocks.find((s) => s.item_id === itemId)
              return (
                <div
                  key={itemId}
                  className="card"
                  data-testid={`zettle-export-${itemId}`}
                >
                  <Link className="text-link" href={`/intake/items/${itemId}`}>
                    I-{itemId.slice(0, 8).toUpperCase()}
                  </Link>
                  {stock && <p>{d.stockStates[stock.status]}</p>}
                  {(images ?? [])
                    .filter((image) => image.item_id === itemId)
                    .map((image) => (
                      <p key={image.item_id}>{d.imageStates[image.status]}</p>
                    ))}
                  {stock && images !== null && (
                    <ZettleAction
                      command={{
                        action: 'exportImage',
                        tenantId: a.id,
                        itemId,
                      }}
                      d={d}
                      label={d.exportImage}
                    />
                  )}
                  {stock?.status !== 'depleted' && (
                    <ZettleAction
                      key={`${itemId}-${stock?.checked_at ?? 'new'}`}
                      command={{ action: 'export', tenantId: a.id, itemId }}
                      d={d}
                      label={stock ? d.checkStock : d.exportItem}
                    />
                  )}
                </div>
              )
            })}
          </section>
        )}
        <details>
          <summary>{d.vatTitle}</summary>
          <p>{d.vatHint}</p>
          {['owner', 'admin'].includes(a.role) && (
            <ZettleAction
              key={catalog.config?.id ?? 'new'}
              command={{
                action: 'configure',
                tenantId: a.id,
                previousId: catalog.config?.id ?? null,
                vatMap: catalog.config?.vat_map ?? {},
              }}
              d={d}
              label={d.saveMapping}
              vatModes={all.sales.vatModes}
            />
          )}
        </details>
        <details>
          <summary>{d.productStatus}</summary>
          {catalog.outcomes.map((o, i) => (
            <p key={`${o.export_id}-${i}`}>
              {o.status === 'synced' ? d.synced : d.productFailed}
              {o.error_code
                ? `: ${(d.errors as Record<string, string>)[o.error_code] ?? d.failed}`
                : ''}
            </p>
          ))}
        </details>
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
