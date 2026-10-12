'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import { Button } from '@/components/ui/button'
import type { ItemSyncConnection } from '@/lib/engine/item-sync'
import type { Dictionary } from '@/lib/i18n'
import { ZettleAction } from './zettle-action'

/** Provider-specific transport stays outside item pages and the shared status view. */
export function ItemSyncAction({
  state,
  tenantId,
  d,
}: {
  state: ItemSyncConnection
  tenantId: string
  d: Dictionary
}) {
  if (state.provider === 'paypal')
    return (
      <ZettleAction
        key={`${state.itemId}-${state.productAt}-${state.stockAt}`}
        command={{ action: 'export', tenantId, itemId: state.itemId }}
        d={d.zettle}
        label={d.itemSync.syncNow}
      />
    )
  return <ShopifySyncAction state={state} tenantId={tenantId} d={d} />
}

function ShopifySyncAction({
  state,
  tenantId,
  d,
}: {
  state: ItemSyncConnection
  tenantId: string
  d: Dictionary
}) {
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  async function send() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'exportItem',
          itemId: state.itemId,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(
          (d.shopify.errors as Record<string, string>)[body.error] ??
            d.itemSync.states.failed,
        )
      } else router.refresh()
    } catch {
      setError(d.shopify.errors.SHOPIFY_OUTCOME_UNKNOWN)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div>
      <Button type="button" disabled={busy} onClick={() => void send()}>
        {busy
          ? d.shopify.exporting
          : error
            ? d.itemSync.retry
            : d.itemSync.syncNow}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
