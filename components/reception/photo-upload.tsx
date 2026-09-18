'use client'
import { useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import type { ReceptionSession } from '@/lib/engine/reception'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false
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
  const hydrated = useSyncExternalStore(subscribe, clientReady, serverReady)
  const input = useRef<HTMLInputElement>(null),
    pending = useRef<{
      file: File
      id: string
      saveId: string
      source?: ReceptionSession['sources'][number]
    } | null>(null),
    removal = useRef<{ id: string; requestId: string } | null>(null),
    running = useRef(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [locked, setLocked] = useState(false),
    [conflict, setConflict] = useState(false),
    [selected, setSelected] = useState(false),
    [removingId, setRemovingId] = useState<string | null>(null)
  const router = useRouter()
  async function removePhoto(id: string) {
    if (running.current || conflict || pending.current) return
    if (removal.current && removal.current.id !== id) return
    removal.current ??= { id, requestId: crypto.randomUUID() }
    setRemovingId(id)
    running.current = true
    setBusy(true)
    setLocked(true)
    setError('')
    try {
      const response = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveReceptionSources',
          tenantId,
          sessionId,
          requestId: removal.current.requestId,
          expectedRevision: revision,
          sources: sources.filter((source) => source.id !== id),
        }),
      })
      if (!response.ok) {
        setConflict(true)
        setError(d.failed)
        return
      }
      router.refresh()
    } catch {
      setError(d.photoRemoveFailed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className="intake-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (running.current || conflict || removal.current) return
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
            if (!uploaded.ok) {
              const failure = await uploaded.json().catch(() => null)
              if (
                failure?.error === 'INVALID_IMAGE' ||
                failure?.error === 'IMAGE_TOO_LARGE'
              ) {
                pending.current = null
                setLocked(false)
                setError(d.photoInvalid)
                return
              }
              throw new Error('upload')
            }
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
          disabled={locked || !hydrated}
          onChange={(event) =>
            setSelected(Boolean(event.currentTarget.files?.length))
          }
        />
      </div>
      {selected && !locked && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (input.current) input.current.value = ''
            setSelected(false)
            setError('')
          }}
        >
          {d.photoRemove}
        </Button>
      )}
      <p className="photo-upload-hint">{d.photoRequirements}</p>
      <p className="photo-upload-hint">{d.photoPrivacyReminder}</p>
      <Button
        disabled={busy || conflict || !!removingId || sources.length >= 20}
      >
        {locked ? d.retryButton : d.photoSave}
      </Button>
      <details className="photo-upload-info">
        <summary>{d.photoPrivacyTitle}</summary>
        <p>{d.photoHelp}</p>
      </details>
      <div className="reception-photos">
        {sources
          .filter((source) => source.kind === 'photo')
          .map((source) => (
            <div className="reception-photo" key={source.id}>
              {/* Authenticated private route; never use an image optimizer cache. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/reception/${sessionId}/photo?photo=${source.id}`}
                alt={d.photoAlt}
                loading="lazy"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={
                  busy || conflict || (locked && removingId !== source.id)
                }
                onClick={() => removePhoto(source.id)}
              >
                {removingId === source.id && error
                  ? d.retryButton
                  : d.photoRemove}
              </Button>
            </div>
          ))}
      </div>
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
