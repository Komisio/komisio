'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReceptionSession } from '@/lib/engine/reception'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
export function PhotoUpload({
  tenantId,
  sessionId,
  revision,
  sources,
  d,
}: {
  tenantId: string
  sessionId: string
  revision: number
  sources: ReceptionSession['sources']
  d: Dictionary['reception']
}) {
  const input = useRef<HTMLInputElement>(null),
    pending = useRef<{
      file: File
      id: string
      saveId: string
      source?: ReceptionSession['sources'][number]
    } | null>(null),
    running = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [locked, setLocked] = useState(false),
    [conflict, setConflict] = useState(false)
  const router = useRouter()
  return (
    <form
      className="intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (running.current || conflict) return
        setError('')
        if (!pending.current) {
          const file = input.current?.files?.[0]
          if (!file || file.size > 3145728 || sources.length >= 20) {
            setError(d.photoInvalid)
            return
          }
          pending.current = {
            file,
            id: crypto.randomUUID(),
            saveId: crypto.randomUUID(),
          }
        }
        running.current = true
        setBusy(true)
        setLocked(true)
        try {
          const task = pending.current
          if (!task.source) {
            const uploaded = await fetch(
              `/api/reception/${sessionId}/photo?tenant=${tenantId}&photo=${task.id}`,
              { method: 'POST', body: task.file },
            )
            if (!uploaded.ok) throw new Error('upload')
            task.source = (await uploaded.json()).source
          }
          const saved = await fetch('/api/intake', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'saveReceptionSources',
              tenantId,
              sessionId,
              requestId: task.saveId,
              expectedRevision: revision,
              sources: [...sources, task.source],
            }),
          })
          if (!saved.ok) {
            setConflict(true)
            setError(d.failed)
            return
          }
          pending.current = null
          router.refresh()
        } catch {
          setError(d.photoFailed)
        } finally {
          running.current = false
          setBusy(false)
        }
      }}
    >
      <div className="field">
        <label htmlFor="reception-photo">{d.photoSelect}</label>
        <input
          ref={input}
          id="reception-photo"
          type="file"
          accept="image/jpeg,image/png"
          capture="environment"
          required
          disabled={locked}
        />
      </div>
      <p>{d.photoHelp}</p>
      <Button disabled={busy || conflict || sources.length >= 20}>
        {locked ? d.retryButton : d.photoSave}
      </Button>
      {error && <p role="alert">{error}</p>}
      {(conflict || error) && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
        >
          {d.reload}
        </Button>
      )}
    </form>
  )
}
