import type { Dictionary } from '@/lib/i18n'
import type { PlanStatus } from '@/lib/engine/plans'

/** The store's plan on the settings page: state, dates and what they mean. */
export function PlanPanel({
  status,
  locale,
  d,
}: {
  status: PlanStatus | null
  locale: string
  d: Dictionary['plans']
}) {
  if (!status || !status.billing) return null
  const date = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === 'sv' ? 'sv-SE' : 'en-GB', {
          timeZone: 'Europe/Stockholm',
        })
      : null
  const deadline =
    status.state === 'trial'
      ? [d.trialEndsAt, date(status.trialEndsAt)]
      : status.state === 'past_due'
        ? [d.graceEndsAt, date(status.graceEndsAt)]
        : status.state === 'active' && status.activeUntil
          ? [d.activeUntil, date(status.activeUntil)]
          : null
  return (
    <section className="card intake-form" aria-label={d.heading}>
      <h2>{d.heading}</h2>
      <p>
        <strong>{d.states[status.state]}</strong>
        {deadline?.[1] ? ` · ${deadline[0]} ${deadline[1]}` : ''}
      </p>
      <p>{d.explain[status.state]}</p>
      <p>
        <small>{d.priceNote}</small>
      </p>
    </section>
  )
}
