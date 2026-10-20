'use client'
import {
  createContext,
  Suspense,
  useContext,
  useId,
  type ReactNode,
} from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { Dictionary } from '@/lib/i18n'
import { supportMail, type SupportContext } from '@/lib/help/support'

const Support = createContext<SupportContext | null>(null)
export function HelpSupportProvider({
  value,
  children,
}: {
  value: SupportContext
  children?: ReactNode
}) {
  return <Support.Provider value={value}>{children}</Support.Provider>
}

type ContactProps = {
  d: Dictionary['helpCenter']['support']
  inDialog?: boolean
}
function Contact({ d, inDialog }: ContactProps) {
  const context = useContext(Support)
  const pathname = usePathname()
  const query = useSearchParams()
  const id = useId()
  const Heading = inDialog ? 'h3' : 'h2'
  if (!context) return null
  const mail = supportMail(
    context,
    { pathname, view: query.get('view'), tab: query.get('tab') },
    d,
  )
  return (
    <section className="help-support" aria-labelledby={id}>
      <Heading id={id}>{d.title}</Heading>
      <div className="help-support-actions">
        <a className="btn btn-secondary" href={mail.href}>
          {d.email}
        </a>
        {context.url && (
          <a
            className="text-link"
            href={context.url}
            target="_blank"
            rel="noreferrer"
          >
            {d.website}
            <span className="sr-only"> · {d.newTab}</span>
          </a>
        )}
      </div>
      <p className="help-support-address">{context.email}</p>
    </section>
  )
}
export function ContactSupport(props: ContactProps) {
  return (
    <Suspense fallback={null}>
      <Contact {...props} />
    </Suspense>
  )
}
