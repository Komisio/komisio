'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import type { RegistrationCommand } from '@/lib/engine/seller-registration'
import type { Dictionary } from '@/lib/i18n'

/** Preserve the exact command after an uncertain response; do not duplicate a decision. */
export function useRegistrationCommand(d: Dictionary['selfRegistration']) {
  const pending = useRef<RegistrationCommand | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [uncertain, setUncertain] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function send(input: RegistrationCommand): Promise<boolean> {
    if (running.current || done) return false
    running.current = true
    setBusy(true)
    setError('')
    pending.current ??= input
    try {
      const r = await fetch('/api/seller-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      if (r.status >= 500) throw new Error('UNCERTAIN')
      const body = await r.json()
      if (!r.ok) {
        const messages: Record<string, string> = {
          REGISTRATION_EMAIL_CHANGED: d.emailChanged,
          REGISTRATION_AMBIGUOUS: d.ambiguous,
          REGISTRATION_DISABLED: d.unavailable,
          AGREEMENT_REQUIRED: d.agreementRequired,
          AGREEMENT_CHANGED: d.changed,
          REGISTRATION_CHANGED: d.changed,
          REGISTRATION_REVIEWED: d.changed,
          REQUEST_CONFLICT: d.changed,
        }
        setError(messages[body.error] ?? d.error)
        pending.current = null
        setUncertain(false)
        return false
      }
      pending.current = null
      setUncertain(false)
      setDone(true)
      return true
    } catch {
      setError(d.uncertain)
      setUncertain(true)
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return {
    send,
    busy,
    uncertain,
    done,
    error,
    locked: busy || uncertain || done,
  }
}
