'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Compact facts remain available by pointer, keyboard and touch. */
export function ItemIndicator({
  label,
  children,
  warning = false,
}: {
  label: string
  children: ReactNode
  warning?: boolean
}) {
  const [position, setPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()
  function cancel() {
    if (timer.current) clearTimeout(timer.current)
  }
  function show() {
    cancel()
    const r = button.current?.getBoundingClientRect()
    if (r)
      setPosition({
        left: Math.max(8, Math.min(r.left, innerWidth - 256)),
        top:
          r.bottom + 90 > innerHeight ? Math.max(8, r.top - 90) : r.bottom + 4,
      })
  }
  function leave() {
    cancel()
    timer.current = setTimeout(() => {
      if (document.activeElement !== button.current) setPosition(null)
    }, 150)
  }
  useEffect(() => () => cancel(), [])
  const open = !!position
  useEffect(() => {
    if (!open) return
    const close = () => setPosition(null)
    const reposition = () => {
      if (document.activeElement !== button.current) return close()
      const r = button.current?.getBoundingClientRect()
      if (
        !r ||
        r.bottom < 0 ||
        r.top > innerHeight ||
        r.right < 0 ||
        r.left > innerWidth
      )
        return close()
      // Keyboard focus can scroll a far-right table cell into view after onFocus.
      setPosition({
        left: Math.max(8, Math.min(r.left, innerWidth - 256)),
        top:
          r.bottom + 90 > innerHeight ? Math.max(8, r.top - 90) : r.bottom + 4,
      })
    }
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
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])
  return (
    <>
      <button
        type="button"
        className="inventory-icon"
        data-warning={warning || undefined}
        ref={button}
        aria-label={label}
        aria-describedby={position ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={leave}
        onClick={show}
      >
        {children}
      </button>
      {position &&
        createPortal(
          <span
            ref={panel}
            id={id}
            role="tooltip"
            className="inventory-tooltip"
            style={position}
            onMouseEnter={cancel}
            onMouseLeave={leave}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  )
}
