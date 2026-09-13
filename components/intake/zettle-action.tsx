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
  vatModes,
}: {
  command: Draft<Command>
  d: Dictionary['zettle']
  label: string
  match?: boolean
  vatModes?: Record<string, string>
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
      if (body.catalog?.some((r: { error?: string }) => r.error))
        setError(d.catalogIssues)
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
          ...(command.action === 'configure'
            ? {
                vatMap: Object.fromEntries(
                  Object.keys(vatModes ?? {}).flatMap((k) => {
                    const v = String(
                      new FormData(e.currentTarget).get(k) ?? '',
                    ).trim()
                    return v === '' ? [] : [[k, Number(v)]]
                  }),
                ),
              }
            : {}),
          ...(match
            ? {
                itemId: String(
                  new FormData(e.currentTarget).get('itemId'),
                ).trim(),
              }
            : {}),
        } as Command
        void send()
      }}
    >
      {command.action === 'configure' &&
        Object.entries(vatModes ?? {}).map(([mode, title]) => (
          <div className="field" key={mode}>
            <label htmlFor={`${id}-${mode}`}>{title} (%)</label>
            <input
              id={`${id}-${mode}`}
              name={mode}
              type="number"
              min="0"
              max="100"
              step="0.01"
              defaultValue={
                command.vatMap[mode as keyof typeof command.vatMap] ?? ''
              }
              disabled={state !== 'idle'}
            />
          </div>
        ))}
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
        <p role="status">{error || d.done}</p>
      ) : (
        <Button type="submit" disabled={state === 'busy'}>
          {state === 'busy' ? d.busy : state === 'retry' ? d.retry : label}
        </Button>
      )}
    </form>
  )
}
