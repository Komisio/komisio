import type { SupabaseClient } from '@supabase/supabase-js'
import type { Dictionary } from '@/lib/i18n'
import type { FortnoxConnectionStatus } from '@/lib/engine/fortnox-connection'
import { readAccountingMap } from '@/lib/engine/accounting'
import { readStoreCurrency } from '@/lib/engine/money'
import { readFortnoxHelp } from '@/lib/engine/fortnox-help'
import {
  fortnoxProgress,
  type FortnoxProgressFacts,
} from '@/lib/help/fortnox-progress'
import type { HelpTopic } from '@/lib/help/topics'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import { ContextHelp } from './context-help'

export async function FortnoxGuide({
  client,
  tenantId,
  role,
  connection,
  ready,
  d,
  initiallyOpen = true,
}: {
  client: SupabaseClient
  tenantId: string
  role: string
  connection: FortnoxConnectionStatus
  initiallyOpen?: boolean
  ready: boolean
  d: Dictionary['helpCenter']
}) {
  const [map, currency] = await Promise.all([
    readAccountingMap(client, tenantId).catch(() => null),
    readStoreCurrency(client, tenantId).catch(() => null),
  ])
  const records =
    map === null
      ? { exported: null, sent: null }
      : await readFortnoxHelp(
          client,
          tenantId,
          map.id,
          connection.databaseNumber,
        ).catch(() => ({ exported: null, sent: null }))
  const facts: FortnoxProgressFacts = {
    connected: connection.connected,
    mapped: map === null ? null : map.id !== null,
    ...records,
  }
  const steps = fortnoxProgress(facts)
  const next = steps.find((step) => step.state !== 'done')
  const canManage = role === 'owner' || role === 'admin'
  const canAct =
    next?.key === 'exported'
      ? ['owner', 'admin', 'staff'].includes(role)
      : canManage
  const topic: HelpTopic =
    !next || next.key === 'exported' || next.key === 'sent'
      ? 'fortnox-first-export'
      : 'fortnox-connect'
  const path =
    next?.key === 'connected'
      ? '/intake/accounting?view=settings#fortnox-connection'
      : next?.key === 'mapped'
        ? '/intake/accounting?view=settings#account-map'
        : '/intake/accounting'
  return (
    <details className="card fortnox-guide" open={initiallyOpen && !!next}>
      <summary>{d.guide.title}</summary>
      <p>{d.guide.intro}</p>
      {connection.connected && (
        <p>
          {d.guide.company}: <strong>{connection.companyName}</strong>
        </p>
      )}
      <ol className="fortnox-guide-steps">
        {steps.map((step) => (
          <li key={step.key}>
            <span>{d.guide.steps[step.key]}</span>
            <small>{d.guide.states[step.state]}</small>
          </li>
        ))}
      </ol>
      {!ready && <p className="intake-notice">{d.guide.hostUnavailable}</p>}
      {currency !== null && currency !== 'SEK' && (
        <p className="intake-notice">{d.guide.currency}</p>
      )}
      {currency === null && <p>{d.guide.states.unknown}</p>}
      <p>{next ? d.guide.next : d.guide.complete}</p>
      <div className="row wrap">
        {next &&
          canAct &&
          next.state !== 'unknown' &&
          (next.key !== 'sent' || (ready && currency === 'SEK')) && (
            <Link className="btn btn-secondary" href={path}>
              {d.guide.steps[next.key]}
            </Link>
          )}
        <ContextHelp key={tenantId} topic={topic} d={d} />
      </div>
      {next && !canAct && (
        <p>
          {next.key === 'exported'
            ? d.guide.staffNeeded
            : d.guide.managerNeeded}
        </p>
      )}
      <p className="muted">
        <small>{d.guide.limits}</small>
      </p>
    </details>
  )
}
