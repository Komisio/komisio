'use client'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { NavigationLink as Link } from '@/components/platform/navigation-warning'
import type { Dictionary } from '@/lib/i18n'
import type { HelpTopic } from '@/lib/help/topics'
import { HelpArticle } from './article'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

/** Native modal semantics keep background forms mounted and focus inside help. */
export function ContextHelp({
  topic,
  d,
  label,
}: {
  topic: HelpTopic
  d: Dictionary['helpCenter']
  label?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const id = useId()
  const pathname = usePathname()
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    dialog.current?.close()
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])
  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={!ready}
        className="btn btn-secondary"
        aria-haspopup="dialog"
        aria-controls={id}
        onClick={() => {
          dialog.current?.showModal()
          setOpen(true)
          heading.current?.focus()
        }}
      >
        {label ?? d.open}
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="help-dialog"
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false)
          trigger.current?.focus()
        }}
      >
        <div className="help-dialog-heading">
          <h2 ref={heading} tabIndex={-1} id={`${id}-title`}>
            {d.articles[topic].title}
          </h2>
          <Button
            type="button"
            variant="secondary"
            onClick={() => dialog.current?.close()}
          >
            {d.close}
          </Button>
        </div>
        <HelpArticle
          topic={topic}
          d={d}
          onNavigate={() => dialog.current?.close()}
        />
        <p>
          <Link
            className="text-link"
            href={`/help/${topic}`}
            target="_blank"
            rel="noreferrer"
          >
            {d.fullArticle}
          </Link>
        </p>
      </dialog>
    </>
  )
}
