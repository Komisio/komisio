'use client'
import { useRef, useState } from 'react'
import { useBusyState } from '@/components/platform/work-activity'
import type { Dictionary } from '@/lib/i18n'
import { confirmsEconomicResult } from './economic-result'

/** An unanswered mutation locks this view until the operator reloads its facts. */
export function useEconomicAction(tenantId: string, d: Dictionary['economic']) {
  const running = useRef(false)
  const uncertain = useRef(false)
  const [busy, setBusy] = useBusyState(false)
  const [error, setError] = useState('')
  const [locked, setLocked] = useState(false)
  async function run(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    if (running.current || uncertain.current) return null
    running.current = true
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/integrations/economic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, ...input }),
      })
      if (response.status >= 500) throw new Error('unanswered')
      const body: Record<string, unknown> = await response.json()
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('unanswered')
      if (!response.ok) {
        setError(
          (d.errors as Record<string, string>)[String(body.error)] ?? d.unknown,
        )
        return null
      }
      if (!confirmsEconomicResult(input.action, body))
        throw new Error('unanswered')
      return body
    } catch {
      if (input.action !== 'catalogue' && input.action !== 'check') {
        uncertain.current = true
        setLocked(true)
      }
      setError(d.unknown)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy, error, locked }
}
