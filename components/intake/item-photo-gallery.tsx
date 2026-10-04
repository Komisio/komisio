'use client'
import Image from 'next/image'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { Dictionary } from '@/lib/i18n'
import {
  itemPhotoState,
  type ItemPhotoState,
} from '@/lib/engine/item-photo-types'
import { itemPhotoUrl } from './item-photo-preview'

type Pending = {
  requestId: string
  photoId: string
  action: 'add' | 'default' | 'remove'
  expected: number
  file?: File
}
export function ItemPhotoGallery({
  tenantId,
  initial,
  title,
  write,
  d,
}: {
  tenantId: string
  initial: ItemPhotoState
  title: string
  write: boolean
  d: Dictionary['itemPhotos']
}) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [reload, setReload] = useState(false)
  const [failed, setFailed] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null),
    running = useRef(false)
  const router = useRouter()
  async function send(command: Pending) {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    setMessage('')
    setPending(command)
    try {
      const params = new URLSearchParams({
        tenantId,
        requestId: command.requestId,
        photoId: command.photoId,
        expected: String(command.expected),
        action: command.action,
      })
      const response = await fetch(
        `/api/items/${state.itemId}/photos?${params}`,
        {
          method: 'POST',
          body: command.file,
          signal: AbortSignal.timeout(20000),
        },
      )
      const body = await response.json()
      if (!response.ok) {
        const code = String(body.error)
        if (
          [
            'ITEM_PHOTOS_CHANGED',
            'TENANT_CHANGED',
            'REQUEST_CONFLICT',
            'AUTH_REQUIRED',
            'FORBIDDEN',
          ].includes(code)
        ) {
          setReload(true)
          setError(d.changed)
        } else if (
          [
            'INVALID_IMAGE',
            'IMAGE_TOO_LARGE',
            'PHOTO_LIMIT',
            'PHOTO_NOT_FOUND',
            'ITEM_NOT_FOUND',
          ].includes(code)
        ) {
          setError((d.errors as Record<string, string>)[code] ?? d.failed)
          setPending(null)
        } else setError(d.unconfirmed)
        return
      }
      const next = itemPhotoState.safeParse(body.state)
      if (
        body.requestId !== command.requestId ||
        !next.success ||
        next.data.itemId !== state.itemId ||
        next.data.revision < command.expected + 1
      )
        throw new Error('UNCONFIRMED')
      setState(next.data)
      setPending(null)
      setMessage(d.saved)
      if (input.current) input.current.value = ''
      router.refresh()
    } catch {
      setError(d.unconfirmed)
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  function change(action: Pending['action'], photoId: string, file?: File) {
    void send({
      action,
      photoId,
      file,
      requestId: crypto.randomUUID(),
      expected: state.revision,
    })
  }
  const locked = busy || !!pending
  return (
    <section
      className="card intake-form item-photo-gallery"
      aria-label={d.title}
    >
      <h2>
        {d.title}{' '}
        <span className="item-photo-count">{state.photos.length}/20</span>
      </h2>
      <p>{d.hint}</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending &&
        !busy &&
        (reload ? (
          <Button type="button" onClick={() => window.location.reload()}>
            {d.reload}
          </Button>
        ) : (
          <Button type="button" onClick={() => void send(pending)}>
            {d.retry}
          </Button>
        ))}
      {state.photos.length === 0 && <p>{d.empty}</p>}
      <div className="item-photo-grid">
        {state.photos.map((photo, index) => (
          <figure
            key={photo.id}
            data-default={photo.id === state.defaultPhotoId}
          >
            {failed.includes(photo.id) ? (
              <p>
                {d.loadFailed}
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    setFailed(failed.filter((id) => id !== photo.id))
                  }
                >
                  {d.retry}
                </button>
              </p>
            ) : (
              <Image
                src={itemPhotoUrl(tenantId, state.itemId, photo.id)}
                alt={`${title} · ${index + 1}`}
                width={320}
                height={240}
                unoptimized
                onError={() => setFailed([...failed, photo.id])}
              />
            )}
            <figcaption>
              {photo.id === state.defaultPhotoId ? (
                <strong>{d.defaultPhoto}</strong>
              ) : write ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={locked}
                  onClick={() => change('default', photo.id)}
                >
                  {d.setDefault}
                </Button>
              ) : null}
              {write && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => change('remove', photo.id)}
                >
                  {d.remove}
                </Button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {write && (
        <div className="field">
          <label htmlFor="item-photo-file">{d.add}</label>
          <input
            id="item-photo-file"
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            disabled={locked || state.photos.length >= 20}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              if (file.size > 3 * 1024 * 1024) {
                setError(d.errors.IMAGE_TOO_LARGE)
                e.target.value = ''
                return
              }
              change('add', crypto.randomUUID(), file)
            }}
          />
          <small>{busy ? d.busy : d.fileHint}</small>
        </div>
      )}
    </section>
  )
}
