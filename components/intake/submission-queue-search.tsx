'use client'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { useConfirmNavigation } from '@/components/platform/navigation-warning'

export function SubmissionQueueSearch({
  view,
  query,
  d,
}: {
  view: string
  query: string
  d: Dictionary['submissions']
}) {
  const confirm = useConfirmNavigation(),
    router = useRouter()
  return (
    <form
      method="get"
      className="row wrap submission-queue-search"
      onSubmit={(event) => {
        event.preventDefault()
        if (!confirm()) return
        const q = String(
          new FormData(event.currentTarget).get('q') ?? '',
        ).trim()
        router.push(`/intake/submissions?${new URLSearchParams({ view, q })}`)
      }}
    >
      <input type="hidden" name="view" value={view} />
      <div className="field">
        <label htmlFor="submission-search">{d.queueSearch}</label>
        <input
          id="submission-search"
          name="q"
          defaultValue={query}
          maxLength={100}
          type="search"
        />
      </div>
      <button className="btn btn-secondary">{d.queueFind}</button>
    </form>
  )
}
