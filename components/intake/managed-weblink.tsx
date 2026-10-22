'use client'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useBusyState } from '@/components/platform/work-activity'
import { useRouter } from '@/components/platform/use-working-router'
import type { Dictionary } from '@/lib/i18n'

export function ManagedWeblink({
  tenantId,
  printerId,
  paired,
  d,
}: {
  tenantId: string
  printerId: string
  paired: boolean
  d: Dictionary['printing']['weblink']['managed']
}) {
  const router = useRouter()
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [ready, setReady] = useState(paired)
  const [attempted, setAttempted] = useState(paired)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  async function perform(action: 'connect' | 'configuration') {
    if (running.current) return
    running.current = true
    if (action === 'connect') setAttempted(true)
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const r = await fetch('/api/print/weblink/managed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tenantId, printerId }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || data.ok !== true || typeof data.deviceId !== 'string') {
        setFailed(true)
        setMessage(
          data.error === 'PRINT_MANAGED_PAUSE_FIRST'
            ? d.pauseFirst
            : data.error === 'PRINT_MANAGED_DEVICE_CONFLICT'
              ? d.conflict
              : d.unknown,
        )
        return
      }
      if (action === 'connect') {
        setReady(true)
        setMessage(d.prepared)
        router.refresh()
      } else {
        if (
          typeof data.configuration !== 'string' ||
          data.configuration.length > 20000
        )
          throw new Error('invalid')
        const url = URL.createObjectURL(
          new Blob([data.configuration], { type: 'application/octet-stream' }),
        )
        const a = document.createElement('a')
        a.href = url
        a.download = 'komisio-zebra-setup.zpl'
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        setMessage(d.downloaded)
      }
    } catch {
      setFailed(true)
      setMessage(d.unknown)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="managed-weblink" aria-label={d.title}>
      <h4>{d.title}</h4>
      <p>{d.hint}</p>
      <div className="row">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void perform('connect')}
        >
          {busy ? d.working : attempted ? d.check : d.prepare}
        </Button>
        {ready && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void perform('configuration')}
          >
            {d.download}
          </Button>
        )}
      </div>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
      {ready && (
        <>
          <ol>
            {[d.step1, d.step2, d.step3].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>{d.private}</p>
        </>
      )}
    </section>
  )
}
