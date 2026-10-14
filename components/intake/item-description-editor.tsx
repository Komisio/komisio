'use client'
import { useRef, useState } from 'react'
import { useRouter } from '@/components/platform/use-working-router'
import { useBusyState } from '@/components/platform/work-activity'
import type { Dictionary } from '@/lib/i18n'
import { editDescriptionInput } from '@/lib/engine/item-presentation'

export function ItemDescriptionEditor({
  tenantId,
  itemId,
  title,
  d,
}: {
  tenantId: string
  itemId: string
  title: string
  d: Dictionary['itemWorkflow']
}) {
  const router = useRouter(),
    [text, setText] = useState(title),
    [busy, setBusy] = useBusyState(false)
  const [status, setStatus] = useState(''),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false)
  const pending = useRef<ReturnType<typeof editDescriptionInput.parse> | null>(
      null,
    ),
    running = useRef(false)
  return (
    <details className="card">
      <summary>{d.edit}</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (running.current || refused) return
          const command =
            pending.current ??
            editDescriptionInput.parse({
              tenantId,
              itemId,
              requestId: crypto.randomUUID(),
              expected: title,
              title: text,
            })
          pending.current = command
          running.current = true
          setBusy(true)
          setLocked(true)
          setStatus('')
          try {
            const r = await fetch('/api/items/description', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(command),
            })
            const body = await r.json()
            if (
              r.ok &&
              body.ok === true &&
              body.corrected === true &&
              body.value === command.title
            ) {
              pending.current = null
              setLocked(false)
              setStatus(d.saved)
              router.refresh()
            } else if (r.status >= 400 && r.status < 500) {
              setRefused(true)
              setStatus(d.changed)
            } else setStatus(d.uncertain)
          } catch {
            setStatus(d.uncertain)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        <label>
          {d.description}
          <textarea
            aria-label={d.description}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            maxLength={1000}
            disabled={locked || busy}
            rows={3}
          />
        </label>
        <small>{d.historyHint}</small>
        <div className="row wrap">
          <button className="btn" disabled={busy || refused || !text.trim()}>
            {d.save}
          </button>
          {refused && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
            >
              {d.reload}
            </button>
          )}
        </div>
        {status && <p role="status">{status}</p>}
      </form>
    </details>
  )
}
