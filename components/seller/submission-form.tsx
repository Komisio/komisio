'use client'
import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { photoLimit } from '@/lib/media/reception-photo'
import {
  submissionSuggestion,
  type SubmissionSuggestion,
} from '@/lib/assistance/submission-suggestion'
import { SubmissionEstimate } from './submission-estimate'
import { SubmissionPhotos } from './submission-photos'
type Photo = { file: File; id: string; path: string; uploaded: boolean }
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
  const router = useRouter(),
    hintId = useId()
  const photos = useRef<Photo[]>([]),
    analysisId = useRef<string | null>(null),
    running = useRef(false)
  const pending = useRef<{
    requestId: string
    description: string
    photos: string[]
    assistanceId?: string
  } | null>(null)
  const [uploaded, setUploaded] = useState<string[]>([]),
    [description, setDescription] = useState('')
  const [suggestion, setSuggestion] = useState<{
    output: SubmissionSuggestion
    currency: string
  } | null>(null)
  const [analysing, setAnalysing] = useState(false),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [saved, setSaved] = useState(false)
  const [error, setError] = useState(''),
    [aiMessage, setAiMessage] = useState(''),
    [hasPhotos, setHasPhotos] = useState(false)
  async function analyse() {
    if (running.current || !photos.current.length) return
    running.current = true
    setAnalysing(true)
    setAiMessage('')
    setError('')
    analysisId.current ??= crypto.randomUUID()
    try {
      for (const photo of photos.current) {
        if (photo.uploaded) continue
        const query = new URLSearchParams({
          tenant: tenantId,
          seller: sellerId,
          photo: photo.id,
        })
        const response = await fetch(`/api/seller/submissions/photo?${query}`, {
          method: 'POST',
          body: photo.file,
          signal: AbortSignal.timeout(30000),
        })
        const result = await response.json()
        if (!response.ok || result.source?.path !== photo.path)
          throw new Error('UPLOAD_FAILED')
        photo.uploaded = true
      }
      setUploaded(photos.current.map((p) => p.path))
      const response = await fetch('/api/seller/submissions/assistance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          sellerId,
          requestId: analysisId.current,
          photos: photos.current.map((p) => p.path),
        }),
        signal: AbortSignal.timeout(55000),
      })
      const result = await response.json()
      if (!response.ok) {
        setAiMessage(d.aiUnavailable)
        return
      }
      if (result.id !== analysisId.current) throw new Error('UNCONFIRMED')
      if (result.status === 'ready') {
        const output = submissionSuggestion.parse(result.output)
        if (
          typeof result.currency !== 'string' ||
          !/^[A-Z]{3}$/.test(result.currency)
        )
          throw new Error('INVALID_RESULT')
        setSuggestion({ output, currency: result.currency })
        setDescription(output.description)
      } else if (result.status === 'failed') {
        analysisId.current = null
        setAiMessage(d.aiUnavailable)
      } else setAiMessage(d.aiPending)
    } catch {
      setAiMessage(d.aiPending)
    } finally {
      running.current = false
      setAnalysing(false)
    }
  }
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (
          running.current ||
          saved ||
          uploaded.length === 0 ||
          !uploaded.length
        )
          return
        pending.current ??= {
          requestId: crypto.randomUUID(),
          description: description.trim(),
          photos: uploaded,
          ...(suggestion && analysisId.current
            ? { assistanceId: analysisId.current }
            : {}),
        }
        running.current = true
        setBusy(true)
        setLocked(true)
        setError('')
        try {
          const response = await fetch('/api/seller/submissions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              sellerId,
              previousId,
              ...pending.current,
            }),
            signal: AbortSignal.timeout(30000),
          })
          const result = await response.json()
          if (!response.ok || result.id !== pending.current.requestId)
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
          <fieldset
            disabled={locked || analysing}
            className="submission-fields"
          >
            <label>
              {d.photos}
              <input
                name="photos"
                type="file"
                accept="image/jpeg,image/png"
                multiple
                required
                aria-describedby={hintId}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  if (
                    !files.length ||
                    files.length > 8 ||
                    files.some(
                      (f) =>
                        f.size > photoLimit ||
                        !['image/jpeg', 'image/png'].includes(f.type),
                    )
                  ) {
                    event.target.value = ''
                    photos.current = []
                    setUploaded([])
                    setHasPhotos(false)
                    setSuggestion(null)
                    setError(d.photoHint)
                    return
                  }
                  photos.current = files.map((file) => {
                    const id = crypto.randomUUID()
                    return {
                      file,
                      id,
                      path: `${tenantId}/${sellerId}/${id}.jpg`,
                      uploaded: false,
                    }
                  })
                  analysisId.current = null
                  pending.current = null
                  setSuggestion(null)
                  setUploaded([])
                  setDescription('')
                  setHasPhotos(true)
                  void analyse()
                }}
              />
            </label>
            <small id={hintId}>{d.photoHint}</small>
          </fieldset>
          {!!uploaded.length && (
            <SubmissionPhotos photos={uploaded} label={d.photos} />
          )}
          {analysing && <p role="status">{d.analysing}</p>}
          {aiMessage && <p role="status">{aiMessage}</p>}
          {hasPhotos && !suggestion && !analysing && !locked && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void analyse()}
            >
              {d.analyse}
            </button>
          )}
          {hasPhotos && (
            <div className="submission-description-field">
              <label htmlFor={`${hintId}-description`}>
                {d.descriptionLabel}
              </label>
              <textarea
                id={`${hintId}-description`}
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                maxLength={2000}
                rows={3}
                disabled={locked || analysing}
              />
            </div>
          )}
          {suggestion && <SubmissionEstimate {...suggestion} d={d} />}
          {hasPhotos && (
            <button
              className="btn btn-primary"
              disabled={
                busy ||
                analysing ||
                uploaded.length === 0 ||
                !description.trim()
              }
              aria-busy={busy}
            >
              {busy
                ? '…'
                : locked
                  ? d.retry
                  : previousId
                    ? d.complement
                    : d.send}
            </button>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{d.sent}</p>}
    </form>
  )
}
