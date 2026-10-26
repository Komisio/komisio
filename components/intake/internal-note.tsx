'use client'
import { useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { useUnsavedChanges } from '@/components/platform/navigation-warning'
import { useBusyState } from '@/components/platform/work-activity'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false
export function InternalNote({
  tenantId,
  kind,
  subjectId,
  initial,
  editable,
  d,
}: {
  tenantId: string
  kind: 'item' | 'reception' | 'purchase'
  subjectId: string
  initial: { id: string | null; note: string }
  editable: boolean
  d: Dictionary
}) {
  const t = d.registration,
    prefix = useId()
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [record, setRecord] = useState(initial),
    [note, setNote] = useState(initial.note),
    [message, setMessage] = useState(''),
    [locked, setLocked] = useState(false),
    [refused, setRefused] = useState(false),
    [busy, setBusy] = useBusyState(false)
  const pending = useRef<{
      action: 'note'
      tenantId: string
      requestId: string
      expectedId: string | null
      kind: typeof kind
      subjectId: string
      note: string
    } | null>(null),
    running = useRef(false)
  useUnsavedChanges(
    note !== record.note || locked ? d.leaveUnsaved : null,
    prefix,
  )
  async function save() {
    if (running.current || refused) return
    const c = pending.current ?? {
      action: 'note',
      tenantId,
      requestId: crypto.randomUUID(),
      expectedId: record.id,
      kind,
      subjectId,
      note: note.trim(),
    }
    pending.current = c
    running.current = true
    setBusy(true)
    setLocked(true)
    try {
      const response = await fetch('/api/registration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(c),
        }),
        body = await response.json()
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          setRefused(true)
          setMessage(t.changed)
        } else setMessage(t.uncertain)
        return
      }
      if (body.id !== c.requestId) throw Error()
      setRecord({ id: c.requestId, note: c.note })
      setNote(c.note)
      pending.current = null
      setLocked(false)
      setMessage(t.saved)
    } catch {
      setMessage(t.uncertain)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <section className="card">
      <div className="field">
        <label htmlFor={prefix}>{t.note}</label>
        <textarea
          id={prefix}
          rows={3}
          maxLength={2000}
          value={note}
          disabled={!ready || !editable || locked}
          onChange={(e) => setNote(e.target.value)}
          aria-describedby={`${prefix}-hint`}
        />
        <small id={`${prefix}-hint`}>{t.noteHint}</small>
      </div>
      {editable && (
        <Button
          type="button"
          disabled={busy || refused || (note === record.note && !locked)}
          onClick={() => void save()}
        >
          {locked ? t.retry : t.save}
        </Button>
      )}
      <p role="status">{message}</p>
    </section>
  )
}
