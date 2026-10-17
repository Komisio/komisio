'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import {
  agreementDeleteResult,
  agreementLinkSummary,
  type AgreementUsage,
} from '@/lib/engine/agreement-deletion'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'

export function DeleteSellerAgreement({
  tenantId,
  agreementId,
  name,
  d,
}: {
  tenantId: string
  agreementId: string
  name: string
  d: Dictionary['agreements']['workspace']['deletion']
}) {
  const router = useRouter()
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
      const response = await fetch('/api/agreements/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, agreementId }),
      })
      const result = agreementDeleteResult.safeParse(await response.json())
      if (!response.ok || !result.success) {
        setMessage(d.failed)
        return
      }
      if (result.data.ok) {
        if (result.data.agreementId !== agreementId) {
          setMessage(d.failed)
          return
        }
        const url = new URL(window.location.href)
        if (url.searchParams.get('version') === agreementId) {
          url.searchParams.delete('version')
          url.searchParams.delete('translation')
          url.searchParams.delete('sellersPage')
        }
        router.push(`${url.pathname}${url.search}`)
        router.refresh()
      } else {
        setMessage(linkedText(d, result.data.usage))
        setConfirming(false)
      }
    } catch {
      setMessage(d.failed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div className="agreement-delete" ref={container}>
      {!confirming ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${d.remove}: ${name}`}
          onClick={() => {
            setConfirming(true)
            setMessage('')
          }}
        >
          {d.remove}
        </Button>
      ) : (
        <>
          <p>{d.confirm.replace('{name}', name)}</p>
          <div className="agreement-delete-actions">
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? d.removing : d.confirmAction}
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
              {d.cancel}
            </Button>
          </div>
        </>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  )
}

function linkedText(
  d: Dictionary['agreements']['workspace']['deletion'],
  usage: AgreementUsage,
) {
  const details = agreementLinkSummary(usage, d.usage)
  return details ? `${d.linked} ${details}` : d.linked
}
