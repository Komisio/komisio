'use client'
import NextLink, { useLinkStatus } from 'next/link'
import { Suspense, useSyncExternalStore, type ComponentProps } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  detailFromOrigin,
  isStaffDetailHref,
  sameStaffView,
} from '@/lib/platform/return-navigation'
import { rememberReturnPosition } from '@/lib/platform/return-scroll'
import { useWorkActivity } from './work-activity'

function LinkActivity() {
  const { pending } = useLinkStatus()
  useWorkActivity(pending)
  return null
}

/** Next owns cancellation, same-page anchors, downloads and modifier clicks. */
type Props = ComponentProps<typeof NextLink> & { preserveOrigin?: boolean }
function PlainLink({ children, ...props }: ComponentProps<typeof NextLink>) {
  return (
    <NextLink {...props}>
      {children}
      <LinkActivity />
    </NextLink>
  )
}

function subscribeHash(notify: () => void) {
  window.addEventListener('hashchange', notify)
  window.addEventListener('popstate', notify)
  return () => {
    window.removeEventListener('hashchange', notify)
    window.removeEventListener('popstate', notify)
  }
}
function OriginLink({
  href,
  onNavigate,
  ...props
}: ComponentProps<typeof NextLink> & { href: string }) {
  const path = usePathname()
  const search = useSearchParams().toString()
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  )
  const origin = path + (search ? '?' + search : '') + hash
  const destination = detailFromOrigin(href, origin)
  return (
    <PlainLink
      {...props}
      href={destination}
      onNavigate={(event) => {
        let cancelled = false
        onNavigate?.({
          preventDefault() {
            cancelled = true
            event.preventDefault()
          },
        })
        if (cancelled) return
        // NavigationLink owns unsaved-work confirmation. An aborted transition
        // must not create a new position; saving no state is also safe here.
        if (
          destination !== href ||
          new URL(href, window.location.href).searchParams.has('returnTo')
        ) {
          const target = new URL(
            destination,
            window.location.href,
          ).searchParams.get('returnTo')
          if (target && sameStaffView(target, origin))
            rememberReturnPosition(target, window.scrollY)
        }
      }}
    />
  )
}

export default function WorkingLink({
  preserveOrigin = true,
  ...props
}: Props) {
  if (!preserveOrigin || props.download || !isStaffDetailHref(props.href))
    return <PlainLink {...props} />
  return (
    <Suspense fallback={<PlainLink {...props} />}>
      <OriginLink {...props} href={props.href} />
    </Suspense>
  )
}
