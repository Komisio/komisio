'use client'
import type { z } from 'zod'
import type { economicStatus } from '@/lib/engine/economic'
import type { EconomicCopy } from '@/lib/accounting/economic-copy'
import { ReloadAction } from './reload-action'
import { useRouter } from '@/components/platform/use-working-router'
import { Button } from '@/components/ui/button'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { useEconomicAction } from './use-economic-action'

export function EconomicConnection({
  tenantId,
  status,
  configured,
  editable,
  outcome,
  d,
}: {
  tenantId: string
  status: z.infer<typeof economicStatus> | null
  configured: boolean
  editable: boolean
  outcome?: string
  d: EconomicCopy
}) {
  const t = d.economic,
    action = useEconomicAction(tenantId, t),
    router = useRouter()
  return (
    <section id="economic-connection" className="card intake-form">
      <h3>e-conomic</h3>
      <p>{t.intro}</p>
      <p>
        {status?.connected
          ? `${status.companyName} · ${t.agreement} ${status.agreementNumber} · ${status.organisationNumber ?? ''}`
          : t.notConnected}
      </p>
      {outcome && (
        <p role={outcome === 'connected' ? 'status' : 'alert'}>
          {outcome === 'connected'
            ? t.connected
            : ((t.errors as Record<string, string>)[outcome] ?? t.unknown)}
        </p>
      )}
      {!configured || !status ? (
        <p>{t.notConfigured}</p>
      ) : (
        editable && (
          <div className="row wrap">
            <a
              className="btn btn-secondary"
              href={`/api/integrations/economic/connect?tenant=${tenantId}`}
            >
              {status.connected ? t.reconnect : t.connect}
            </a>
            {status.connected && (
              <>
                <Button
                  type="button"
                  disabled={action.busy || action.locked}
                  onClick={async () => {
                    if (await action.run({ action: 'check' })) router.refresh()
                  }}
                >
                  {t.check}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={action.busy || action.locked}
                  onClick={async () => {
                    if (await action.run({ action: 'disconnect' }))
                      router.refresh()
                  }}
                >
                  {d.fortnox.disconnect}
                </Button>
              </>
            )}
          </div>
        )
      )}
      {action.error && <p role="alert">{action.error}</p>}
      {action.locked && <ReloadAction label={d.reload} />}
      <p>
        <Link
          className="text-link"
          href="/intake/accounting?view=accounts&destination=economic"
        >
          {d.accounting.mapHeading} · e-conomic
        </Link>
      </p>
      <details>
        <summary>{t.helpTitle}</summary>
        <ol>
          <li>
            {t.connect} · {t.check}
          </li>
          <li>
            {t.loadCatalogue}. {t.mapHint} {t.feeHint}
          </li>
          <li>
            {t.prepare} · {t.send}
          </li>
          <li>{t.confirmHint}</li>
        </ol>
        <p>{t.errors.ECONOMIC_ACCESS_DENIED}</p>
        <p>{t.disconnectNotice}</p>
      </details>
      {status && status.events.length > 0 && (
        <details>
          <summary>{d.accounting.details}</summary>
          <ul>
            {status.events.map((event, index) => (
              <li key={index}>
                <time dateTime={event.occurredAt}>{event.occurredAt}</time> ·{' '}
                {d.fortnox.events[event.kind]} · {event.agreementNumber ?? '—'}
                {event.reason &&
                  ` · ${(t.errors as Record<string, string>)[event.reason] ?? t.unknown}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
