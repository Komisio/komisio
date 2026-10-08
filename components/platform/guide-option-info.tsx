'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

export function GuideOptionInfo({
  label,
  text,
}: {
  label: string
  text: string
}) {
  const id = useId()
  const root = useRef<HTMLSpanElement>(null)
  const pinned = useRef(false)
  const [open, setOpen] = useState(false)
  function close() {
    pinned.current = false
    setOpen(false)
  }
  useEffect(() => {
    if (!open) return
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) {
        pinned.current = false
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return (
    <span
      ref={root}
      className="guide-option-info"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setOpen(true)
      }}
      onPointerLeave={() => {
        if (!pinned.current && !root.current?.contains(document.activeElement))
          setOpen(false)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <button
        type="button"
        className="guide-info-button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onClick={() => {
          if (pinned.current) close()
          else {
            pinned.current = true
            setOpen(true)
          }
        }}
      >
        <Info size={18} aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className="guide-option-tooltip"
      >
        {text}
      </span>
    </span>
  )
}
