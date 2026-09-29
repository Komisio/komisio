import Link from 'next/link'
import { intlLocale, type Dictionary } from '@/lib/i18n'
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
  const when = (iso: string) =>
    new Date(iso).toLocaleString(intlLocale(locale), {
      timeZone: 'Europe/Stockholm',
    })
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
        {d.statuses.queued} {when(job.created_at)}
        {job.completed_at
          ? ` · ${d.statuses[job.status]} ${when(job.completed_at)}`
          : ''}
      </small>
      {job.error && <p role="alert">{job.error}</p>}
    </div>
  )
}
