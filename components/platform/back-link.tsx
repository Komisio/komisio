'use client'
import { Suspense, type ComponentProps } from 'react'
import { useSearchParams } from 'next/navigation'
import { NavigationLink } from './navigation-warning'
import { staffReturnHref } from '@/lib/platform/return-navigation'
import { requestReturnPosition } from '@/lib/platform/return-scroll'

type Props = Omit<ComponentProps<typeof NavigationLink>, 'href'> & {
  href: string
}
function ResolvedBackLink({ href, onNavigate, ...props }: Props) {
  const query = useSearchParams()
  const destination = staffReturnHref(query.get('returnTo'), href)
  return (
    <NavigationLink
      {...props}
      href={destination}
      preserveOrigin={false}
      onNavigate={(event) => {
        onNavigate?.(event)
        requestReturnPosition(destination)
      }}
    />
  )
}
/** Origin is in the URL; a save or refresh never changes it to a history offset. */
export function BackLink(props: Props) {
  return (
    <Suspense fallback={<NavigationLink {...props} preserveOrigin={false} />}>
      <ResolvedBackLink {...props} />
    </Suspense>
  )
}
