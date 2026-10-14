'use client'

import { useContext } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { useConfirmNavigation } from '@/components/platform/navigation-warning'
import { useRouter } from '@/components/platform/use-working-router'
import { WorkspaceSearchTransition } from '@/components/ui/workspace-tabs'
import { Button } from '@/components/ui/button'

export function PurchaseFilters({
  query,
  status,
  sort,
  direction,
  d,
}: {
  query: string
  status: string
  sort: string
  direction: string
  d: Dictionary['purchases']
}) {
  const router = useRouter()
  const confirm = useConfirmNavigation('item-acceptance')
  const transition = useContext(WorkspaceSearchTransition)
  return (
    <form
      className="purchase-filters"
      onSubmit={(event) => {
        event.preventDefault()
        if (!confirm()) return
        const fields = new FormData(event.currentTarget)
        const params = new URLSearchParams({ sort, direction })
        const query = String(fields.get('q') ?? '').trim()
        if (query) params.set('q', query)
        const status = String(fields.get('status') ?? 'all')
        if (status !== 'all') params.set('status', status)
        const navigate = () =>
          router.push(`/intake/purchases?${params}#purchases-history`)
        if (transition) transition(navigate)
        else navigate()
      }}
    >
      <div className="field">
        <label htmlFor="purchase-search">{d.search}</label>
        <input
          id="purchase-search"
          type="search"
          name="q"
          defaultValue={query}
          maxLength={120}
          placeholder={d.searchPlaceholder}
        />
      </div>
      <div className="field">
        <label htmlFor="purchase-status">{d.status}</label>
        <select id="purchase-status" name="status" defaultValue={status}>
          <option value="all">{d.statusAll}</option>
          <option value="pending">{d.statusPending}</option>
          <option value="registered">{d.statusRegistered}</option>
        </select>
      </div>
      <Button type="submit">{d.search}</Button>
    </form>
  )
}
