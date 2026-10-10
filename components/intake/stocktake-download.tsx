'use client'

import { useState } from 'react'
import type { Dictionary } from '@/lib/i18n'

export function StocktakeDownload({
  tenantId,
  sessionId,
  filter,
  s,
}: {
  tenantId: string
  sessionId: string
  filter: 'all' | 'deviations'
  s: Dictionary['stocktake']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(
        `/api/stocktake/${sessionId}/export?tenant=${tenantId}&filter=${filter}`,
        { cache: 'no-store' },
      )
      if (!response.ok) {
        setError(response.status === 413 ? s.exportTooLarge : s.exportFailed)
        return
      }
      if (!response.headers.get('content-type')?.startsWith('text/csv'))
        throw new Error('Invalid export response')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `komisio-stocktake-${sessionId}-${filter}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setError(s.exportFailed)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
      >
        {busy
          ? s.exportPreparing
          : filter === 'deviations'
            ? s.exportDeviations
            : s.exportAll}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
