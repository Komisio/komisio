'use client'
import Image from 'next/image'
import { Images } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useId, useRef, useState } from 'react'
import type { Dictionary } from '@/lib/i18n'

function previewPosition(element: HTMLButtonElement | null) {
  const rect = element?.getBoundingClientRect()
  return rect
    ? {
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 240)),
        top:
          rect.bottom + 250 > window.innerHeight
            ? Math.max(8, rect.top - 250)
            : rect.bottom + 4,
      }
    : null
}
export function itemPhotoUrl(
  tenantId: string,
  itemId: string,
  photoId: string,
) {
  return `/api/items/${itemId}/photos?${new URLSearchParams({ tenant: tenantId, photo: photoId })}`
}
export function ItemPhotoPreview({
  tenantId,
  itemId,
  photoId,
  count,
  title,
  d,
}: {
  tenantId: string
  itemId: string
  photoId: string
  count: number
  title: string
  d: Dictionary['itemPhotos']
}) {
  const [position, setPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()
  function cancelClose() {
    if (timer.current) clearTimeout(timer.current)
  }
  function show() {
    cancelClose()
    setPosition(previewPosition(button.current))
  }
  function leave() {
    cancelClose()
    timer.current = setTimeout(() => {
      if (
        document.activeElement !== button.current &&
        !panel.current?.contains(document.activeElement)
      )
        setPosition(null)
    }, 150)
  }
  useEffect(() => {
    const close = () => setPosition(null)
    // Browser focus can scroll after a tap. Keep the preview anchored instead
    // of immediately dismissing what the user just opened.
    const reposition = () =>
      setPosition((current) =>
        current ? previewPosition(button.current) : null,
      )
    const outside = (e: PointerEvent) => {
      if (
        !button.current?.contains(e.target as Node) &&
        !panel.current?.contains(e.target as Node)
      )
        close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    window.addEventListener('pointerdown', outside)
    return () => {
      cancelClose()
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('pointerdown', outside)
    }
  }, [])
  return (
    <span
      className="item-photo-indicator"
      onMouseEnter={show}
      onMouseLeave={leave}
    >
      <button
        ref={button}
        type="button"
        className="item-photo-icon"
        aria-label={d.preview.replace('{count}', String(count))}
        aria-expanded={!!position}
        aria-controls={position ? id : undefined}
        aria-describedby={position ? id : undefined}
        onFocus={show}
        onBlur={leave}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          show()
        }}
      >
        <Images size={16} aria-hidden="true" />
        <span>{count}</span>
      </button>
      {position &&
        createPortal(
          <span
            id={id}
            ref={panel}
            role="tooltip"
            className="item-photo-popover"
            style={position}
            onMouseEnter={cancelClose}
            onMouseLeave={leave}
          >
            {failed ? (
              <span>{d.loadFailed}</span>
            ) : (
              <Image
                src={itemPhotoUrl(tenantId, itemId, photoId)}
                alt={title}
                width={216}
                height={200}
                unoptimized
                onError={() => setFailed(true)}
              />
            )}
            <span>{d.defaultPhoto}</span>
          </span>,
          document.body,
        )}
    </span>
  )
}
