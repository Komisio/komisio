import type { Dictionary } from '@/lib/i18n'

export function SubmissionSuccess({
  sellerId,
  d,
}: {
  sellerId: string
  d: Dictionary['submissions']
}) {
  return (
    <div className="submission-success">
      <p role="status">{d.sent}</p>
      <a
        className="btn btn-primary"
        href={`/seller/submissions?seller=${encodeURIComponent(sellerId)}`}
      >
        {d.sendAnother}
      </a>
    </div>
  )
}
