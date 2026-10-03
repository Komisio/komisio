'use client'
import { useEffect, useRef, useState, type RefObject } from 'react'

/** Compare mounted text/settings fields without persisting their contents. */
export function useFormDirty(
  form: RefObject<HTMLFormElement | null>,
  initialFields?: readonly (readonly [string, string])[],
) {
  const baseline = useRef<string | null>(
    initialFields ? JSON.stringify(initialFields) : null,
  )
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (form.current && baseline.current === null)
      baseline.current = JSON.stringify([...new FormData(form.current)])
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
  return { dirty, checkDirty, resetDirty }
}
