'use client'
import { useRef, useState, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import type { zettleCommand } from '@/lib/engine/zettle'
import type { z } from 'zod'
type Command = z.infer<typeof zettleCommand>
type Draft<T> = T extends unknown ? Omit<T, 'requestId'> : never
export function ZettleAction({
  command,
  d,
  label,
  match = false,
}: {
  command: Draft<Command>
  d: Dictionary['zettle']
  label: string
  match?: boolean
}) {
  const router = useRouter(),
    id = useId(),
    pending = useRef<Command | null>(null),
    running = useRef(false)
  const [state, setState] = useState<
    'idle' | 'busy' | 'retry' | 'failed' | 'done'
  >('idle')
  const [error, setError] = useState('')
  async function send() {
    if (running.current || !pending.current) return
    running.current = true
    setState('busy')
    try {
      const r = await fetch('/api/integrations/zettle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending.current),
      })
      if (r.status >= 500) throw new Error('Unknown outcome')
      const body = await r.json()
      if (!r.ok) {
        setError((d.errors as Record<string, string>)[body.error] ?? d.failed)
        setState('failed')
        return
      }
      if (body.id !== pending.current.requestId)
        throw new Error('Unknown outcome')
      setState('done')
      router.refresh()
    } catch {
      setState('retry')
    } finally {
      running.current = false
    }
  }
  return (
    <form
      className="intake-fields"
      onSubmit={(e) => {
        e.preventDefault()
        if (pending.current) {
          if (state === 'retry') void send()
          return
        }
        pending.current = {
          ...command,
          requestId: crypto.randomUUID(),
          ...(match
            ? {
                itemId: String(
                  new FormData(e.currentTarget).get('itemId'),
                ).trim(),
              }
            : {}),
          ...(command.action === 'stage'
            ? { expiresAt: new Date(Date.now() + 86400000).toISOString() }
            : {}),
        } as Command
        void send()
      }}
    >
      {match && (
        <div className="field">
          <label htmlFor={id}>{d.item}</label>
          <input
            id={id}
            name="itemId"
            required
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            disabled={state !== 'idle'}
          />
        </div>
      )}
      {state === 'failed' ? (
        <>
          <p role="alert">{error || d.failed}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            {d.reload}
          </Button>
        </>
      ) : state === 'done' ? (
        <p role="status">{d.done}</p>
      ) : (
        <Button type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? d.busy : state === 'retry' ? d.retry : label}
        </Button>
      )}
    </form>
  )
}
