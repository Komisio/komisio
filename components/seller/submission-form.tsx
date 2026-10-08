'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { photoLimit } from '@/lib/media/reception-photo'

/** The request and upload identities survive ambiguous responses in this form. */
export function SubmissionForm({
  tenantId,
  sellerId,
  previousId = null,
  d,
}: {
  tenantId: string
  sellerId: string
  previousId?: string | null
  d: Dictionary['submissions']
}) {
  const router = useRouter()
  const pending = useRef<{
    id: string
    description: string
    files: { file: File; id: string }[]
  } | null>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (running.current || saved) return
        const form = event.currentTarget
        if (!pending.current) {
          const data = new FormData(form)
          const files = data
            .getAll('photos')
            .filter((f): f is File => f instanceof File && f.size > 0)
          if (
            !files.length ||
            files.length > 8 ||
            files.some(
              (f) =>
                f.size > photoLimit ||
                !['image/jpeg', 'image/png'].includes(f.type),
            )
          ) {
            setError(d.photoHint)
            return
          }
          pending.current = {
            id: crypto.randomUUID(),
            description: String(data.get('description')).trim(),
            files: files.map((file) => ({ file, id: crypto.randomUUID() })),
          }
        }
        running.current = true
        setBusy(true)
        setError('')
        setLocked(true)
        const command = pending.current
        try {
          const photos: string[] = []
          for (const { file, id } of command.files) {
            const path = `${tenantId}/${sellerId}/${id}.jpg`
            const query = new URLSearchParams({
              tenant: tenantId,
              seller: sellerId,
              photo: id,
            })
            const response = await fetch(
              `/api/seller/submissions/photo?${query}`,
              { method: 'POST', body: file },
            )
            const result = await response.json()
            if (!response.ok || result.source?.path !== path)
              throw new Error('UPLOAD_FAILED')
            photos.push(path)
          }
          const response = await fetch('/api/seller/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              sellerId,
              previousId,
              requestId: command.id,
              description: command.description,
              photos,
            }),
          })
          const result = await response.json()
          if (!response.ok || result.id !== command.id)
            throw new Error('UNCONFIRMED')
          setSaved(true)
          router.refresh()
        } catch {
          setError(d.failure)
        } finally {
          running.current = false
          setBusy(false)
        }
      }}
    >
      {!saved && (
        <>
          <fieldset disabled={locked} className="submission-fields">
            <label>
              {d.description}
              <textarea name="description" required maxLength={2000} rows={3} />
            </label>
            <label>
              {d.photos}
              <input
                name="photos"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                required
                aria-describedby="submission-photo-hint"
              />
            </label>
            <small id="submission-photo-hint">{d.photoHint}</small>
          </fieldset>
          <button className="btn" disabled={busy} aria-busy={busy}>
            {busy ? '…' : locked ? d.retry : previousId ? d.complement : d.send}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{d.sent}</p>}
    </form>
  )
}
