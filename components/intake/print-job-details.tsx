import Link from '@/components/platform/working-link'
import type { Dictionary } from '@/lib/i18n'
import { EventTime } from '@/components/ui/event-time'
import type { PrintJob, PrintReference } from '@/lib/engine/printing'

export function PrintJobDetails({
  job,
  printer,
  reference,
  locale,
  d,
  children,
}: {
  job: PrintJob
  printer: string | undefined
  reference: PrintReference | undefined
  locale: string
  children?: React.ReactNode
  d: Dictionary['printing']
}) {
  const status =
    job.dispatch_attempt && job.status === 'printed'
      ? d.weblink.printed
      : d.statuses[job.status]
  return (
    <div className="intake-notice" id={`print-job-${job.id}`}>
      <strong>
        {printer ?? d.printer} · {d.kinds[job.label_kind]} · {status}
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
            {status} <EventTime value={job.completed_at} locale={locale} />
          </>
        )}
      </small>
      {job.dispatch_attempt && !job.dispatch_resolved_at && (
        <p>{d.weblink.acceptanceHint}</p>
      )}
      {job.dispatch_resolution_note && (
        <p>
          {d.weblink.note}: {job.dispatch_resolution_note}
        </p>
      )}
      {children}
      {job.error && <p role="alert">{job.error}</p>}
    </div>
  )
}
