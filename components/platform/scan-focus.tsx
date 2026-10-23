'use client'

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type InputHTMLAttributes,
  type RefObject,
} from 'react'
import { ScanLine } from 'lucide-react'

type ScanField = HTMLInputElement | HTMLTextAreaElement
const subscribeReady = () => () => {}
const clientReady = () => true
const serverReady = () => false
const finePointer = () => window.matchMedia('(pointer: fine)').matches
const visible = (element: HTMLElement) =>
  element.isConnected &&
  element.getClientRects().length > 0 &&
  !element.closest('[hidden],[inert]')
const hasDialog = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      'dialog[open],[role="dialog"][aria-modal="true"]',
    ),
  ].some(visible)
function otherEditor(input: ScanField) {
  const active = document.activeElement
  return (
    active !== input &&
    active instanceof HTMLElement &&
    (active.matches('input,textarea,select') || active.isContentEditable)
  )
}

function fragmentIncludes(field: ScanField) {
  if (!window.location.hash) return true
  try {
    return (
      document
        .getElementById(decodeURIComponent(window.location.hash.slice(1)))
        ?.contains(field) ?? false
    )
  } catch {
    return false
  }
}

/** Focus is a convenience, never a scanner listener or permission to submit. */
export function useScanFocus(
  inputRef: RefObject<ScanField | null>,
  enabled = true,
) {
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady)
  const contextId = useId()
  const armed = useRef(false)
  const generation = useRef(0)
  const pending = useRef<{
    generation: number
    select: boolean
    origin: Element | null
  } | null>(null)
  const visibility = useRef<{
    node: ScanField | null
    shown: boolean
    initial: boolean
  }>({ node: null, shown: false, initial: true })
  const update = useRef<() => void>(() => {})
  const keyboardTabNavigation = useRef(false)
  const focus = useCallback(
    (select = false) => {
      const field = inputRef.current
      if (
        !enabled ||
        !field ||
        !visible(field) ||
        field.disabled ||
        field.readOnly ||
        hasDialog()
      )
        return false
      armed.current = true
      field.focus({ preventScroll: true })
      if (select) field.select()
      return document.activeElement === field
    },
    [inputRef, enabled],
  )
  const focusKeyboard = useCallback(() => {
    const field = inputRef.current
    // An explicit section/item link takes precedence over arrival focus. Even
    // preventScroll cannot stop the shell from revealing a focused editor.
    return (
      !!field &&
      finePointer() &&
      fragmentIncludes(field) &&
      !otherEditor(field) &&
      focus()
    )
  }, [inputRef, focus])

  const focusNext = useCallback(() => {
    const field = inputRef.current
    return (
      !!field &&
      (armed.current || finePointer()) &&
      !otherEditor(field) &&
      focus()
    )
  }, [inputRef, focus])

  useEffect(() => {
    let frame = 0
    const check = () => {
      const field = inputRef.current
      if (!field) return
      if (visibility.current.node !== field)
        visibility.current = { node: field, shown: false, initial: true }
      const shown = visible(field)
      if (!shown) {
        visibility.current.shown = false
        return
      }
      if (!visibility.current.shown) visibility.current.initial = true
      visibility.current.shown = true
      if (!enabled || field.disabled || field.readOnly) return
      const restore = pending.current
      if (restore) {
        pending.current = null
        if (
          restore.generation === generation.current &&
          (document.activeElement === restore.origin || !otherEditor(field))
        )
          focus(restore.select)
      }
      if (visibility.current.initial) {
        visibility.current.initial = false
        // Tab arrow navigation must remain on the tablist. Click/Enter activation
        // may move to its primary field once the panel is visible.
        if (!keyboardTabNavigation.current) focusKeyboard()
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(check)
    }
    update.current = schedule
    const focused = (event: FocusEvent) => {
      if (event.target === inputRef.current) armed.current = true
      else if (event.target !== document.body) generation.current++
    }
    const key = (event: KeyboardEvent) => {
      keyboardTabNavigation.current =
        event.target instanceof HTMLElement &&
        event.target.matches('[role="tab"]') &&
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    }
    const pointer = () => {
      keyboardTabNavigation.current = false
    }
    const observer = new MutationObserver(schedule)
    for (
      let ancestor: HTMLElement | null = inputRef.current;
      ancestor;
      ancestor = ancestor.parentElement
    )
      observer.observe(ancestor, {
        attributes: true,
        attributeFilter: ['hidden', 'open', 'inert', 'disabled', 'readonly'],
      })
    document.addEventListener('focusin', focused)
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', pointer, true)
    window.addEventListener('pageshow', schedule)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener('focusin', focused)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('pointerdown', pointer, true)
      window.removeEventListener('pageshow', schedule)
    }
  }, [inputRef, enabled, focus, focusKeyboard])

  /** Capture before an async command; restore only if the user has not moved on. */
  const prepareRestore = (select = false) => {
    const ticket = generation.current
    const origin = document.activeElement
    const allowed = armed.current || finePointer()
    return () => {
      if (!allowed || ticket !== generation.current) return
      pending.current = { generation: ticket, select, origin }
      update.current()
    }
  }
  return { ready, contextId, focus, focusNext, prepareRestore }
}

export function ScanFocusButton({
  scan,
  label,
  context,
  disabled = false,
}: {
  scan: ReturnType<typeof useScanFocus>
  label: string
  context: string
  disabled?: boolean
}) {
  return (
    <>
      <span className="sr-only" id={scan.contextId}>
        {context}
      </span>
      <button
        type="button"
        className="btn btn-secondary scan-focus-button"
        disabled={!scan.ready || disabled}
        onClick={() => scan.focus()}
      >
        <ScanLine size={20} aria-hidden="true" />
        {label}
      </button>
    </>
  )
}

/** Client focus behavior for a server-rendered search form. */
export function ScanFocusInput({
  focusLabel,
  contextLabel,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'autoFocus'> & {
  focusLabel: string
  contextLabel: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const scan = useScanFocus(input, !props.disabled && !props.readOnly)
  return (
    <div className="scan-focus-field">
      <input
        {...props}
        ref={input}
        aria-describedby={[props['aria-describedby'], scan.contextId]
          .filter(Boolean)
          .join(' ')}
      />
      <ScanFocusButton
        scan={scan}
        label={focusLabel}
        context={contextLabel}
        disabled={props.disabled || props.readOnly}
      />
    </div>
  )
}
