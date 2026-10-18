import type { ConsentState } from '@/lib/engine/store-mail'
import type { Dictionary } from '@/lib/i18n'
import { EventTime } from '@/components/ui/event-time'

export function StoreMailStatus({
  current,
  d,
  locale,
}: {
  current: ConsentState
  locale: string
  d: Dictionary['storeMail']
}) {
  return (
    <div className="stack">
      <p>
        <strong>{d.consentTitle}</strong>
        <br />
        <span>{d.statuses[current.status]}</span>
      </p>
      {current.date && (
        <p className="muted">
          {d.statusDate} <EventTime value={current.date} locale={locale} />
        </p>
      )}
    </div>
  )
}
