import Link from '@/components/platform/working-link'
import { EventTime } from '@/components/ui/event-time'
import { ZettleAction } from './zettle-action'
import type { PayPalItemState } from '@/lib/engine/paypal-status'
import type { Dictionary, Locale } from '@/lib/i18n'

export function PayPalItemStatus({
  state,
  tenantId,
  manage,
  locale,
  d,
}: {
  state: PayPalItemState
  tenantId: string
  manage: boolean
  locale: Locale
  d: Dictionary['zettle']
}) {
  const t = d.itemSync
  return (
    <section
      className="card intake-form paypal-item-status"
      aria-label="PayPal POS"
    >
      <div className="workspace-heading">
        <h2>PayPal POS</h2>
        <span className="paypal-sync-state" data-state={state.status}>
          {t.states[state.status]}
        </span>
      </div>
      <details>
        <summary>{t.details}</summary>
        <p className="muted">{t.observation}</p>
        <dl className="paypal-sync-facts">
          <div>
            <dt>{t.product}</dt>
            <dd>
              {state.productStatus === 'synced'
                ? d.synced
                : state.productStatus === 'failed'
                  ? d.productFailed
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
                ? d.stockStates[state.stockStatus]
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
              {state.imageStatus ? d.imageStates[state.imageStatus] : t.notSent}
            </dd>
          </div>
        </dl>
        {state.errorCode && (
          <p role="status">
            {(d.errors as Record<string, string>)[state.errorCode] ?? d.failed}
          </p>
        )}
      </details>
      <div className="workspace-actions">
        {manage && state.connected && state.canExport && (
          <ZettleAction
            key={`${state.itemId}-${state.productAt}-${state.stockAt}`}
            command={{ action: 'export', tenantId, itemId: state.itemId }}
            d={d}
            label={t.syncNow}
          />
        )}
        <Link className="text-link" href="/intake/integrations?provider=paypal">
          {state.connected ? t.settings : d.connect}
        </Link>
      </div>
    </section>
  )
}
