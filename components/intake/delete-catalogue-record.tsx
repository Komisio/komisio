'use client'
import { useEffect, useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'
import {
  catalogueDeleteResult,
  type catalogueDeleteInput,
} from '@/lib/engine/catalogue-deletion'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'

export function DeleteCatalogueRecord({
  tenantId,
  kind,
  recordKey,
  name,
  d,
  onDeleted,
}: {
  tenantId: string
  kind: z.infer<typeof catalogueDeleteInput>['kind']
  recordKey: string
  name: string
  d: Dictionary
  onDeleted: () => void
}) {
  const t = d.catalogueDeletion
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useBusyState(false)
  const running = useRef(false)
  const [message, setMessage] = useState('')
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (message && !confirming)
      container.current?.querySelector('button')?.focus()
  }, [message, confirming])
  async function remove() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch('/api/catalogue/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, kind, key: recordKey }),
      })
      const result = catalogueDeleteResult.safeParse(await response.json())
      if (!response.ok || !result.success) {
        setMessage(t.failed)
        return
      }
      if (result.data.ok) {
        if (result.data.key !== recordKey || result.data.kind !== kind) {
          setMessage(t.failed)
          return
        }
        onDeleted()
      } else {
        setMessage(
          t.inUse +
            ' ' +
            Object.entries(result.data.usage)
              .map(
                ([key, count]) =>
                  `${t.usage[key as keyof typeof t.usage]}: ${count}`,
              )
              .join(' · '),
        )
        setConfirming(false)
      }
    } catch {
      setMessage(t.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="catalogue-delete" ref={container}>
      {!confirming ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${t.remove}: ${name}`}
          onClick={() => {
            setConfirming(true)
            setMessage('')
          }}
        >
          {t.remove}
        </Button>
      ) : (
        <>
          <p>{t.confirm.replace('{name}', name)}</p>
          <div className="catalogue-delete-actions">
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? t.removing : t.confirmAction}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false)
                setMessage('')
              }}
            >
              {t.cancel}
            </Button>
          </div>
        </>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  )
}
