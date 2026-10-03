'use client'
import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

/** Compare mounted text/settings fields without persisting their contents. */
export function useFormDirty(
  form: RefObject<HTMLFormElement | null>,
  initialFields?: readonly (readonly [string, string])[],
) {
  const baseline = useRef<string | null>(
    initialFields ? JSON.stringify(initialFields) : null,
  )
  const [dirty, setDirty] = useState(false)
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  // Read the disabled hydration fields from a detached copy, never enabling
  // the live form before its handlers attach.
  useLayoutEffect(() => {
    if (form.current && baseline.current === null) {
      const waiting = form.current.querySelector('[data-draft-readiness]')
      const snapshot = waiting
        ? (form.current.cloneNode(true) as HTMLFormElement)
        : form.current
      if (waiting)
        snapshot
          .querySelectorAll<HTMLFieldSetElement>('[data-draft-readiness]')
          .forEach((fieldset) => {
            fieldset.disabled = false
          })
      baseline.current = JSON.stringify([...new FormData(snapshot)])
    }
  }, [form])
  function checkDirty() {
    // Conditional fields can become enabled in the same React change event.
    queueMicrotask(() => {
      if (form.current && baseline.current !== null)
        setDirty(
          JSON.stringify([...new FormData(form.current)]) !== baseline.current,
        )
    })
  }
  function resetDirty(confirmedFields?: FormData) {
    // A command may finish before React enables its controls again. Callers
    // with a confirmed submitted snapshot can avoid sampling disabled fields.
    const snapshot = confirmedFields
      ? JSON.stringify([...confirmedFields])
      : null
    // A successful editor can mount a fresh form in the same click event.
    queueMicrotask(() => {
      if (form.current) {
        baseline.current =
          snapshot ?? JSON.stringify([...new FormData(form.current)])
        setDirty(false)
      }
    })
  }
  return { ready, dirty, checkDirty, resetDirty }
}
