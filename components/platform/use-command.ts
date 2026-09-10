'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
export function useCommand(d: Dictionary) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const router = useRouter()
  async function run(command: object) {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const response = await fetch('/api/platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setSuccess(d.saved)
      router.refresh()
      return result as { data?: string; inviteUrl?: string }
    } catch (e) {
      const key = e instanceof Error ? e.message : ''
      setError(
        d.errors[key as keyof typeof d.errors] ?? d.errors.REQUEST_FAILED,
      )
      return null
    } finally {
      setBusy(false)
    }
  }
  return { run, busy, error, success, router }
}
