'use client'
import { useId, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { supportPage } from '@/lib/help/support'
import { useHelpContent } from './content-provider'
import { Button } from '@/components/ui/button'

const memory = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const unavailable = () => false
function answered(key: string) {
  if (memory.has(key)) return true
  try {
    return sessionStorage.getItem(key) === 'sent'
  } catch {
    return false
  }
}
export function ArticleFeedback({
  topic,
  d,
}: {
  topic: string
  d: Dictionary['helpCenter']['feedback']
}) {
  const context = useHelpContent()
  const pathname = usePathname(),
    query = useSearchParams(),
    id = useId()
  const key = `komisio-help:${context?.tenantId}:${topic}`
  const sent = useSyncExternalStore(subscribe, () => answered(key), unavailable)
  const [helpful, setHelpful] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const running = useRef(false)
  if (!context) return null
  if (sent) return <p role="status">{d.thanks}</p>
  return (
    <section className="help-feedback" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{d.title}</h3>
      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault()
          if (helpful === null || running.current || uncertain) return
          const fields = new FormData(event.currentTarget)
          running.current = true
          setBusy(true)
          setMessage('')
          try {
            const response = await fetch('/api/help/feedback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                tenantId: context.tenantId,
                slug: topic,
                locale: context.locale,
                page: supportPage(
                  pathname,
                  query.get('view'),
                  query.get('tab'),
                ),
                helpful,
                comment: fields.get('comment') || null,
              }),
            })
            const body = await response.json()
            if (!response.ok) {
              if (response.status >= 500) throw new Error('unknown')
              setMessage(
                body.error === 'RATE_LIMITED' ? d.rateLimited : d.error,
              )
              return
            }
            if (body.submitted !== true) throw new Error('unknown')
            memory.add(key)
            try {
              sessionStorage.setItem(key, 'sent')
            } catch {}
            listeners.forEach((listener) => listener())
          } catch {
            setUncertain(true)
            setMessage(d.unknown)
          } finally {
            running.current = false
            setBusy(false)
          }
        }}
      >
        <fieldset disabled={busy || uncertain}>
          <legend className="sr-only">{d.title}</legend>
          <div className="row wrap">
            <label className="check">
              <input
                type="radio"
                name="helpful"
                checked={helpful === true}
                onChange={() => setHelpful(true)}
              />
              {d.yes}
            </label>
            <label className="check">
              <input
                type="radio"
                name="helpful"
                checked={helpful === false}
                onChange={() => setHelpful(false)}
              />
              {d.no}
            </label>
          </div>
        </fieldset>
        {helpful !== null && (
          <>
            <label htmlFor={`${id}-comment`}>{d.comment}</label>
            <textarea
              id={`${id}-comment`}
              name="comment"
              maxLength={1000}
              aria-describedby={`${id}-hint`}
              disabled={busy || uncertain}
            />
            <p id={`${id}-hint`}>{d.privacy}</p>
            <Button disabled={busy || uncertain}>{d.send}</Button>
          </>
        )}
        {message && <p role="alert">{message}</p>}
      </form>
    </section>
  )
}
