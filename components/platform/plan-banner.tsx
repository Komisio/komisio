import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import type { PlanStatus } from '@/lib/engine/plans'

/** One line about the store's plan when it needs attention; nothing when all is well. */
export function PlanBanner({
  status,
  isOwner,
  d,
}: {
  status: PlanStatus | null
  isOwner: boolean
  d: Dictionary['plans']
}) {
  if (!status || !status.billing) return null
  const fill = (t: string) => t.replace('{days}', String(status.daysLeft ?? 0))
  let text: string | null = null
  let alert = false
  if (status.state === 'trial' && (status.daysLeft ?? 99) <= 7)
    text = fill(d.trialEndingSoon)
  else if (status.state === 'past_due') {
    text = fill(d.pastDue)
    alert = true
  } else if (status.state === 'read_only') {
    text = d.readOnly
    alert = true
  } else if (status.state === 'closed') {
    text = d.closed
    alert = true
  }
  if (!text) return null
  return (
    <p className="intake-notice" role={alert ? 'alert' : 'status'}>
      {text}
      {isOwner && status.state !== 'closed'
        ? ` ${d.contactToActivate}`
        : ''}{' '}
      <Link className="text-link" href="/settings">
        {d.details}
      </Link>
    </p>
  )
}
