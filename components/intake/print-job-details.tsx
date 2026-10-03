import Link from 'next/link'
import type { Dictionary } from '@/lib/i18n'
import { EventTime } from '@/components/ui/event-time'
import type { PrintJob, PrintReference } from '@/lib/engine/printing'

export function PrintJobDetails({
  job,
  printer,
  reference,
  locale,
  d,
}: {
  job: PrintJob
  printer: string | undefined
  reference: PrintReference | undefined
  locale: string
  d: Dictionary['printing']
}) {
  return (
    <div className="intake-notice" id={`print-job-${job.id}`}>
      <strong>
        {printer ?? d.printer} · {d.kinds[job.label_kind]} ·{' '}
        {d.statuses[job.status]}
      </strong>
      <p>
        {reference?.href ? (
          <Link className="text-link" href={reference.href}>
            {reference.label}
          </Link>
        ) : (
          (reference?.label ?? d.sourceUnavailable)
        )}
        {' · '}
        {d.copies}: {job.copies}
      </p>
      <small>
        {d.statuses.queued} <EventTime value={job.created_at} locale={locale} />
        {job.completed_at && (
          <>
            {' · '}
            {d.statuses[job.status]}{' '}
            <EventTime value={job.completed_at} locale={locale} />
          </>
        )}
      </small>
      {job.error && <p role="alert">{job.error}</p>}
    </div>
  )
}
