'use client'
import { useState, useRef } from 'react'
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
  const request = useRef<{
    id: string
    decision: 'approve' | 'decline'
  } | null>(null)
  const router = useRouter()
  async function respond(decision: 'approve' | 'decline') {
    setBusy(true)
    setError('')
    if (!request.current || request.current.decision !== decision)
      request.current = { id: crypto.randomUUID(), decision }
    try {
      const response = await fetch('/api/seller/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          reviewId,
          requestId: request.current.id,
          decision,
        }),
      })
      if (!response.ok) {
        setError(d.reviewResponseError)
        router.refresh()
        return
      }
      router.refresh()
    } catch {
      setError(d.reviewResponseError)
    } finally {
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
      {failed && <p role="alert">{d.reviewPhotoError}</p>}
      {response ? (
        <p role="status">
          {response.decision === 'approve'
            ? d.reviewApproved
            : d.reviewDeclined}
        </p>
      ) : (
        <>
          <label className="row">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {d.reviewConfirm}
          </label>
          <div className="row wrap">
            <Button
              disabled={busy || !checked || !imagesReady}
              onClick={() => respond('approve')}
            >
              {d.reviewApprove}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => respond('decline')}
            >
              {d.reviewDecline}
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  )
}
