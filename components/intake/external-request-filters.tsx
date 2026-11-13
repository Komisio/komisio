'use client'
import { useId } from 'react'
import type { Dictionary } from '@/lib/i18n'
import {
  externalRequestStatuses,
  type ExternalRequestFilters as Filters,
} from '@/lib/engine/external-item-offers'
import {
  externalRequestFilters,
  externalRequestHref,
} from '@/lib/platform/external-request-filters'
import {
  useConfirmNavigation,
  NavigationLink,
} from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import { Search } from 'lucide-react'
import styles from './external-request-queue.module.css'

export function ExternalRequestFilters({
  filters,
  d,
}: {
  filters: Filters
  d: Dictionary['externalOffers']['queue']
}) {
  const router = useRouter()
  const prefix = useId()
  const confirm = useConfirmNavigation()
  return (
    <form
      className={styles.filters}
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (!confirm()) return
        const data = new FormData(event.currentTarget)
        router.push(
          externalRequestHref(
            externalRequestFilters({
              q: String(data.get('q') ?? ''),
              status: String(data.get('status') ?? ''),
            }),
          ),
        )
      }}
    >
      <div className={styles.search}>
        <label htmlFor={`${prefix}-query`}>{d.search}</label>
        <span className={styles.searchInput}>
          <Search size={18} aria-hidden="true" />
          <input
            id={`${prefix}-query`}
            type="search"
            name="q"
            maxLength={120}
            defaultValue={filters.query}
            placeholder={d.searchHint}
          />
        </span>
      </div>
      <div className={styles.statusFilter}>
        <label htmlFor={`${prefix}-status`}>{d.status}</label>
        <select
          id={`${prefix}-status`}
          name="status"
          defaultValue={filters.status}
        >
          {externalRequestStatuses.map((value) => (
            <option key={value} value={value}>
              {d.statuses[value]}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-primary" type="submit">
        {d.apply}
      </button>
      {filters.query || filters.status !== 'all' ? (
        <NavigationLink className={styles.reset} href="/intake/requests">
          {d.reset}
        </NavigationLink>
      ) : null}
    </form>
  )
}
