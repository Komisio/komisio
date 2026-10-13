import Link from '@/components/platform/working-link'
import { EventTime } from '@/components/ui/event-time'
import type { ItemSyncConnection } from '@/lib/engine/item-sync'
import type { Dictionary, Locale } from '@/lib/i18n'
import { ItemSyncAction } from './item-sync-action'

export function ItemSyncStatus({
  connections,
  tenantId,
  manage,
  locale,
  d,
}: {
  connections: ItemSyncConnection[]
  tenantId: string
  manage: boolean
  locale: Locale
  d: Dictionary
}) {
  const t = d.itemSync
  return (
    <section className="card intake-form item-sync-status" aria-label={t.title}>
      <h2>{t.title}</h2>
      {connections.length === 0 ? (
        <Link className="text-link" href="/intake/integrations">
          {t.connect}
        </Link>
      ) : (
        connections.map((state) => (
          <div className="item-sync-connection" key={state.connectionId}>
            <div className="workspace-heading">
              <h3>{t.providers[state.provider]}</h3>
              <span className="item-sync-state" data-state={state.status}>
                {t.states[state.status]}
              </span>
            </div>
            <details>
              <summary>{t.details}</summary>
              <p className="muted">
                {state.status === 'linked'
                  ? d.posImport.helpLink
                  : t.observation}
              </p>
              <dl className="item-sync-facts">
                <div>
                  <dt>{t.product}</dt>
                  <dd>
                    {state.productStatus
                      ? t.productStates[state.productStatus]
                      : t.notConfirmed}
                    {state.productAt && (
                      <>
                        {' '}
                        · <EventTime value={state.productAt} locale={locale} />
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t.stock}</dt>
                  <dd>
                    {state.stockStatus
                      ? t.stockStates[state.stockStatus]
                      : t.notConfirmed}
                    {state.stockAt && (
                      <>
                        {' '}
                        · <EventTime value={state.stockAt} locale={locale} />
                      </>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t.image}</dt>
                  <dd>
                    {state.imageStatus
                      ? t.imageStates[state.imageStatus]
                      : t.notSent}
                  </dd>
                </div>
              </dl>
              {state.errorCode && <p role="status">{syncError(d, state)}</p>}
            </details>
            <div className="workspace-actions">
              {manage && state.connected && state.canExport && (
                <ItemSyncAction state={state} tenantId={tenantId} d={d} />
              )}
              <Link
                className="text-link"
                href={`/intake/integrations?provider=${state.provider}`}
              >
                {state.connected ? t.settings : t.connect}
              </Link>
            </div>
          </div>
        ))
      )}
    </section>
  )
}

function syncError(d: Dictionary, state: ItemSyncConnection) {
  const errors =
    state.provider === 'paypal' ? d.zettle.errors : d.shopify.errors
  return (
    (errors as Record<string, string>)[state.errorCode ?? ''] ??
    d.itemSync.states.failed
  )
}
