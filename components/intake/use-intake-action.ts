'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { intakeCommand } from '@/lib/engine/intake'
import type { Dictionary } from '@/lib/i18n'

export function useIntakeAction(d: Dictionary['intake']) {
  const router = useRouter()
  const pending = useRef<unknown>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [needsReload, setNeedsReload] = useState(false)
  async function run(input: unknown): Promise<string | null> {
    if (running.current || needsReload) return null
    const command = intakeCommand.safeParse(pending.current ?? input)
    if (!command.success) {
      setError(d.invalid)
      return null
    }
    pending.current = command.data
    running.current = true
    setLocked(true)
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command.data),
      })
      const result = await response.json()
      if (!response.ok) {
        const definitive = [
          'INVALID_INPUT',
          'AGREEMENT_CHANGED',
          'AGREEMENT_REQUIRED',
          'INSPECTION_DRAFT_CHANGED',
        ].includes(result.error)
        if (definitive) {
          pending.current = null
          setLocked(false)
        }
        if (
          result.error === 'AGREEMENT_CHANGED' ||
          result.error === 'TENANT_CHANGED' ||
          result.error === 'INSPECTION_DRAFT_CHANGED' ||
          result.error === 'INSPECTION_CONTEXT_CHANGED'
        )
          setNeedsReload(true)
        setError(
          result.error === 'INSPECTION_DRAFT_CHANGED'
            ? d.inspectionChanged
            : result.error === 'INSPECTION_CONTEXT_CHANGED'
              ? d.changed
              : result.error === 'AGREEMENT_CHANGED'
                ? d.agreementChanged
                : result.error === 'AGREEMENT_REQUIRED'
                  ? d.agreementRequired
                  : result.error === 'INVALID_INPUT'
                    ? d.invalid
                    : result.error === 'TENANT_CHANGED'
                      ? d.changed
                      : ['FORBIDDEN', 'AUTH_REQUIRED'].includes(result.error)
                        ? d.denied
                        : d.failed,
        )
        if (result.error === 'AGREEMENT_REQUIRED') router.refresh()
        return null
      }
      pending.current = null
      setLocked(false)
      return result.id
    } catch {
      setError(d.failed)
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy, locked, error, needsReload }
}
