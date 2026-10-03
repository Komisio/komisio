'use client'
import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
export function SellerResponse({
  token,
  reviewId,
  photos,
  response,
  d,
}: {
  token: string
  reviewId: string
  photos: string[]
  response: { decision: 'approve' | 'decline' } | null
  d: Dictionary
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [checked, setChecked] = useState(false)
  const [loaded, setLoaded] = useState<string[]>([]),
    [failed, setFailed] = useState(false)
  const imagesReady = photos.every((id) => loaded.includes(id)) && !failed
  const running = useRef(false)
  const [needsReload, setNeedsReload] = useState(false)
  const [confirmed, setConfirmed] = useState<'approve' | 'decline' | null>(null)
  const [pending, setPending] = useState<'approve' | 'decline' | null>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const status = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (error) alert.current?.focus()
  }, [error])
  useEffect(() => {
    if (confirmed) status.current?.focus()
  }, [confirmed])
  const answer = response?.decision ?? confirmed
  const request = useRef<{
    id: string
    decision: 'approve' | 'decline'
  } | null>(null)
  const router = useRouter()
  async function respond(decision: 'approve' | 'decline') {
    if (running.current || needsReload || answer) return
    if (request.current && request.current.decision !== decision) return
    if (
      !request.current &&
      decision === 'approve' &&
      (!checked || !imagesReady)
    )
      return
    request.current ??= { id: crypto.randomUUID(), decision }
    const command = request.current
    running.current = true
    setPending(decision)
    setBusy(true)
    setError('')
    try {
      const reply = await fetch('/api/seller/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          reviewId,
          requestId: command.id,
          decision: command.decision,
        }),
      })
      const result = await reply.json().catch(() => null)
      if (!reply.ok) {
        const answered = reply.status >= 400 && reply.status < 500
        if (answered && result?.error === 'INVALID_INPUT') {
          request.current = null
          setPending(null)
        } else if (
          answered &&
          [
            'AUTH_REQUIRED',
            'FORBIDDEN',
            'REVIEW_UNAVAILABLE',
            'NOT_FOUND',
          ].includes(result?.error)
        ) {
          setNeedsReload(true)
        }
        setError(d.reviewResponseError)
        return
      }
      if (result?.id !== command.id) {
        setError(d.reviewResponseError)
        return
      }
      setConfirmed(command.decision)
      router.refresh()
    } catch {
      setError(d.reviewResponseError)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return (
    <div>
      {photos.length > 0 && <h2>{d.reviewPhotos}</h2>}
      <div className="reception-photos">
        {photos.map((photo) => (
          // Private, uncached authenticated route; never use a public optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo}
            src={`/api/seller/review/${token}/photo/${photo}`}
            alt={d.reviewPhotoAlt}
            ref={(img) => {
              // A fast load/error may finish before React hydrates the page.
              if (!img?.complete) return
              if (img.naturalWidth > 0)
                setLoaded((ids) =>
                  ids.includes(photo) ? ids : [...ids, photo],
                )
              else setFailed(true)
            }}
            onLoad={() =>
              setLoaded((ids) => (ids.includes(photo) ? ids : [...ids, photo]))
            }
            onError={() => setFailed(true)}
          />
        ))}
      </div>
      {failed && (
        <div>
          <p role="alert">{d.reviewPhotoError}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => window.location.reload()}
          >
            {d.intake.reload}
          </Button>
        </div>
      )}
      {answer ? (
        <p role="status" ref={status} tabIndex={-1}>
          {answer === 'approve' ? d.reviewApproved : d.reviewDeclined}
        </p>
      ) : (
        <>
          <label className="row">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy || pending !== null || needsReload}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {d.reviewConfirm}
          </label>
          <div className="row wrap">
            <Button
              disabled={
                busy ||
                needsReload ||
                pending === 'decline' ||
                (!pending && (!checked || !imagesReady))
              }
              onClick={() => respond('approve')}
            >
              {pending === 'approve'
                ? busy
                  ? d.loading
                  : d.reviewRetryApprove
                : d.reviewApprove}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || needsReload || pending === 'approve'}
              onClick={() => respond('decline')}
            >
              {pending === 'decline'
                ? busy
                  ? d.loading
                  : d.reviewRetryDecline
                : d.reviewDecline}
            </Button>
          </div>
          {error && (
            <p role="alert" ref={alert} tabIndex={-1}>
              {error}
            </p>
          )}
          {needsReload && !failed && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              {d.intake.reload}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
